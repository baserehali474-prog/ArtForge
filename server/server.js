/* =========================================================================
   ArtForge v4.0 — API Server (Phase 2 + Frontend Hosting)
   PostgreSQL backend + Static frontend server
   ========================================================================= */

'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const db = require('./db');
const { hashPassword, verifyPassword, signToken, verifyToken } = require('./auth');

const PORT = process.env.PORT || 4000;


// ---- Service catalog ----
const SERVICES = [
  'poster',
  'motion',
  'reels',
  'video',
  'brand',
  'other'
];

const STATUS_KEYS = [
  'pending',
  'in-progress',
  'revision',
  'completed',
  'delivered',
  'closed'
];

const ROLES = [
  'client',
  'designer',
  'admin'
];


// ---- Rate limiter ----
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 100;

const rateBuckets = new Map();


function rateLimited(ip) {

  const now = Date.now();

  const bucket = rateBuckets.get(ip) || [];

  const fresh = bucket.filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS
  );

  fresh.push(now);

  rateBuckets.set(ip, fresh);

  return fresh.length > RATE_LIMIT_MAX;
}


// ---- Helpers ----

function uid(prefix) {

  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

}


function nowISO() {

  return new Date().toISOString();

}


function sendJSON(res, status, data) {

  const body = JSON.stringify(data);

  res.writeHead(status, {

    'Content-Type':
      'application/json; charset=utf-8',

    'Content-Length':
      Buffer.byteLength(body),

    'X-Content-Type-Options':
      'nosniff',

    'X-Frame-Options':
      'DENY',

    'Referrer-Policy':
      'no-referrer'

  });


  res.end(body);

}



function readBody(req) {

  return new Promise((resolve, reject) => {

    let data = '';

    let size = 0;

    const MAX = 1024 * 1024;


    req.on('data', chunk => {

      size += chunk.length;


      if (size > MAX) {

        reject(
          new Error('payload_too_large')
        );

        req.destroy();

        return;

      }


      data += chunk;

    });



    req.on('end', () => {


      if (!data) {

        return resolve({});

      }


      try {

        resolve(
          JSON.parse(data)
        );

      } catch {

        reject(
          new Error('invalid_json')
        );

      }


    });


    req.on('error', reject);


  });

}



async function getAuthUser(req) {

  const header =
    req.headers['authorization'] || '';


  const token =
    header.startsWith('Bearer ')
      ? header.slice(7)
      : null;


  const payload =
    verifyToken(token);


  if (!payload) {

    return null;

  }


  const row = await db.get(
    'SELECT id, name, email, role FROM users WHERE id = $1 AND deleted_at IS NULL',
    [payload.sub]
  );


  return row || null;

}



function isValidEmail(email) {

  return (
    typeof email === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );

}



// ---- Validation ----

function validateRegisterInput({
  name,
  email,
  password
}) {

  const errors = [];


  if (
    !name ||
    typeof name !== 'string' ||
    name.trim().length < 2
  ) {

    errors.push('نام معتبر نیست');

  }


  if (!isValidEmail(email)) {

    errors.push('ایمیل معتبر نیست');

  }


  if (
    !password ||
    typeof password !== 'string' ||
    password.length < 8
  ) {

    errors.push(
      'رمز عبور باید حداقل ۸ کاراکتر باشد'
    );

  }


  return errors;

}// =====================================================================
// Route handlers
// =====================================================================


async function handleRegister(req, res) {

  const body = await readBody(req);

  const errors = validateRegisterInput(body);


  if (errors.length) {

    return sendJSON(
      res,
      400,
      {
        error: 'validation_error',
        details: errors
      }
    );

  }


  const existing = await db.get(
    'SELECT id FROM users WHERE email = $1',
    [body.email.toLowerCase()]
  );


  if (existing) {

    return sendJSON(
      res,
      409,
      {
        error: 'email_taken'
      }
    );

  }



  const {
    hash,
    salt
  } = hashPassword(body.password);



  const id = uid('usr');


  const role =
    ROLES.includes(body.role)
      ? body.role
      : 'client';


  const finalRole =
    role === 'admin'
      ? 'client'
      : role;



  await db.run(

    `INSERT INTO users
    (
      id,
      name,
      email,
      password_hash,
      password_salt,
      role,
      created_at
    )
    VALUES
    ($1,$2,$3,$4,$5,$6,$7)`,

    [
      id,
      body.name.trim(),
      body.email.toLowerCase(),
      hash,
      salt,
      finalRole,
      nowISO()
    ]

  );



  const token =
    signToken({
      sub: id,
      role: finalRole
    });



  sendJSON(

    res,

    201,

    {
      token,

      user:
      {
        id,
        name: body.name.trim(),
        email: body.email.toLowerCase(),
        role: finalRole
      }

    }

  );

}




async function handleLogin(req,res){

  const body =
    await readBody(req);



  if (
    !isValidEmail(body.email) ||
    !body.password
  ){

    return sendJSON(
      res,
      400,
      {
        error:'validation_error',
        details:[
          'ایمیل یا رمز عبور نامعتبر است'
        ]
      }
    );

  }



  const user =
    await db.get(

      'SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL',

      [
        body.email.toLowerCase()
      ]

    );



  if (
    !user ||
    !verifyPassword(
      body.password,
      user.password_hash,
      user.password_salt
    )
  ){

    return sendJSON(
      res,
      401,
      {
        error:'invalid_credentials'
      }
    );

  }



  const token =
    signToken({
      sub:user.id,
      role:user.role
    });



  sendJSON(
    res,
    200,
    {

      token,

      user:
      {
        id:user.id,
        name:user.name,
        email:user.email,
        role:user.role
      }

    }
  );

}





function handleMe(req,res,user){

  sendJSON(
    res,
    200,
    {
      user
    }
  );

}




async function handleListOrders(req,res,user,query){


  let sql =
    'SELECT * FROM orders WHERE deleted_at IS NULL';



  const params = [];



  if(user.role === 'client'){

    params.push(user.id);

    sql +=
      ` AND user_id = $${params.length}`;

  }



  if(
    query.status &&
    STATUS_KEYS.includes(query.status)
  ){

    params.push(query.status);

    sql +=
      ` AND status = $${params.length}`;

  }



  sql +=
    ' ORDER BY created_at DESC LIMIT 100';



  const rows =
    await db.all(
      sql,
      params
    );



  sendJSON(
    res,
    200,
    {
      orders:rows
    }
  );

}




async function handleCreateOrder(req,res,user){


  const body =
    await readBody(req);



  const errors=[];



  if(
    !body.title ||
    String(body.title).trim().length < 3
  ){

    errors.push(
      'عنوان سفارش نامعتبر است'
    );

  }



  if(
    !SERVICES.includes(body.service)
  ){

    errors.push(
      'نوع خدمت نامعتبر است'
    );

  }



  if(errors.length){

    return sendJSON(
      res,
      400,
      {
        error:'validation_error',
        details:errors
      }
    );

  }




  const id =
    uid('ord');


  const ts =
    nowISO();



  await db.run(

    `INSERT INTO orders
    (
      id,
      user_id,
      title,
      service,
      budget,
      deadline,
      priority,
      status,
      progress,
      description,
      created_at,
      updated_at
    )

    VALUES
    ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,

    [

      id,
      user.id,
      String(body.title).trim(),
      body.service,
      body.budget || null,
      body.deadline || null,
      body.priority || null,
      'pending',
      0,
      body.description || null,
      ts,
      ts

    ]

  );



  const order =
    await db.get(
      'SELECT * FROM orders WHERE id = $1',
      [id]
    );



  sendJSON(
    res,
    201,
    {
      order
    }
  );


}





async function handleListNotifications(req,res,user){


  const rows =
    await db.all(

      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',

      [
        user.id
      ]

    );



  sendJSON(
    res,
    200,
    {
      notifications:rows
    }
  );


}




function handleHealth(req,res){

  sendJSON(
    res,
    200,
    {
      status:'ok',
      time:nowISO()
    }
  );

}// =====================================================================
// Static frontend serving
// =====================================================================

function serveFrontend(req, res, requestPath) {

  let filePath;


  if (requestPath === '/') {

    filePath = path.join(
      __dirname,
      '..',
      'index.html'
    );

  } else {

    const safePath =
      path.normalize(requestPath)
      .replace(/^(\.\.[\/\\])+/, '');


    filePath =
      path.join(
        __dirname,
        '..',
        safePath
      );

  }



  if (
    fs.existsSync(filePath) &&
    fs.statSync(filePath).isFile()
  ) {


    const ext =
      path.extname(filePath);



    const contentTypes = {

      '.html':
        'text/html; charset=utf-8',

      '.css':
        'text/css; charset=utf-8',

      '.js':
        'application/javascript; charset=utf-8',

      '.ttf':
        'font/ttf',

      '.otf':
        'font/otf',

      '.png':
        'image/png',

      '.jpg':
        'image/jpeg',

      '.jpeg':
        'image/jpeg',

      '.svg':
        'image/svg+xml'

    };



    res.writeHead(
      200,
      {
        'Content-Type':
          contentTypes[ext] ||
          'application/octet-stream'
      }
    );


    return res.end(
      fs.readFileSync(filePath)
    );


  }


  return false;

}



// =====================================================================
// Router
// =====================================================================


const server =
http.createServer(async (req,res)=>{


  const ip =
    req.socket.remoteAddress ||
    'unknown';



  if(rateLimited(ip)){

    return sendJSON(
      res,
      429,
      {
        error:'rate_limited'
      }
    );

  }



  // ---- CORS ----

  res.setHeader(
    'Access-Control-Allow-Origin',
    process.env.ARTFORGE_ORIGIN || '*'
  );


  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,POST,PATCH,DELETE,OPTIONS'
  );


  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );



  if(req.method === 'OPTIONS'){

    res.writeHead(204);

    return res.end();

  }




  const url =
    new URL(
      req.url,
      `http://${req.headers.host}`
    );


  const route =
    url.pathname;



  const query =
    Object.fromEntries(
      url.searchParams.entries()
    );



  try {



    // ---------------------------
    // Public API
    // ---------------------------


    if(
      route === '/api/health' &&
      req.method === 'GET'
    ){

      return handleHealth(req,res);

    }



    if(
      route === '/api/auth/register' &&
      req.method === 'POST'
    ){

      return await handleRegister(req,res);

    }




    if(
      route === '/api/auth/login' &&
      req.method === 'POST'
    ){

      return await handleLogin(req,res);

    }




    // ---------------------------
    // Frontend files
    // ---------------------------


    if(
      req.method === 'GET' &&
      serveFrontend(req,res,route)
    ){

      return;

    }




    // ---------------------------
    // Protected API
    // ---------------------------


    const user =
      await getAuthUser(req);



    if(!user){

      return sendJSON(
        res,
        401,
        {
          error:'unauthorized'
        }
      );

    }




    if(
      route === '/api/auth/me' &&
      req.method === 'GET'
    ){

      return handleMe(
        req,
        res,
        user
      );

    }




    if(
      route === '/api/orders' &&
      req.method === 'GET'
    ){

      return await handleListOrders(
        req,
        res,
        user,
        query
      );

    }





    if(
      route === '/api/orders' &&
      req.method === 'POST'
    ){

      return await handleCreateOrder(
        req,
        res,
        user
      );

    }




    if(
      route === '/api/notifications' &&
      req.method === 'GET'
    ){

      return await handleListNotifications(
        req,
        res,
        user
      );

    }





    const orderMatch =
      route.match(
        /^\/api\/orders\/([\w-]+)$/
      );



    if(
      orderMatch &&
      req.method === 'GET'
    ){

      const order =
        await db.get(
          'SELECT * FROM orders WHERE id = $1 AND deleted_at IS NULL',
          [orderMatch[1]]
        );


      if(!order){

        return sendJSON(
          res,
          404,
          {
            error:'not_found'
          }
        );

      }


      return sendJSON(
        res,
        200,
        {
          order
        }
      );

    }




    sendJSON(
      res,
      404,
      {
        error:'route_not_found'
      }
    );



  } catch(err){



    if(
      err.message === 'invalid_json'
    ){

      return sendJSON(
        res,
        400,
        {
          error:'invalid_json'
        }
      );

    }



    if(
      err.message === 'payload_too_large'
    ){

      return sendJSON(
        res,
        413,
        {
          error:'payload_too_large'
        }
      );

    }



    console.error(err);



    sendJSON(
      res,
      500,
      {
        error:'internal_error'
      }
    );

  }



});




// =====================================================================
// Start server
// =====================================================================


db.init()

.then(()=>{


  server.listen(
    PORT,
    ()=>{

      console.log(
        `ArtForge API listening on http://localhost:${PORT}`
      );

    }
  );


})


.catch(err=>{


  console.error(
    'Failed to initialize database:',
    err
  );


  process.exit(1);


});



module.exports = server;
