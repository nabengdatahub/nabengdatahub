require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const app = express();
app.set('trust proxy', 1); // Render sits behind a trusted reverse proxy
const PORT = Number(process.env.PORT || 3000);
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_PUBLIC = process.env.PAYSTACK_PUBLIC_KEY;
const DATARJUST_API_KEY = process.env.DATARJUST_API_KEY;
const DATARJUST_BASE = (process.env.DATARJUST_BASE_URL || 'https://datarjust.com/api').replace(/\/$/, '');
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5500';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;


if (!PAYSTACK_SECRET || !PAYSTACK_PUBLIC || !DATARJUST_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required environment variables. Check .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});


// Server-side catalogue is authoritative. Values must match frontend packages.
// Prices = your selling prices (with profit). datarjust is charged the lower cost price.
const CATALOGUE = {
  mtn: { network: 'MTN', code: 'mtn', packages: {
    1:['1GB','MTN 1GB',4.50],2:['2GB','MTN 2GB',8.80],3:['3GB','MTN 3GB',13.00],4:['4GB','MTN 4GB',17.00],5:['5GB','MTN 5GB',21.00],6:['6GB','MTN 6GB',25.00],7:['7GB','MTN 7GB',29.00],8:['8GB','MTN 8GB',34.00],9:['10GB','MTN 10GB',42.00],11:['15GB','MTN 15GB',61.00],12:['20GB','MTN 20GB',80.00],13:['25GB','MTN 25GB',98.50],14:['30GB','MTN 30GB',118.00],15:['40GB','MTN 40GB',156.00],16:['50GB','MTN 50GB',195.00]
  }},
  mtn_xpress: { network: 'Express MTN', code: 'mtn_xpress', packages: {
    43:['1GB','Express 1GB',4.50],44:['2GB','Express 2GB',8.80],45:['3GB','Express 3GB',13.00],46:['4GB','Express 4GB',17.00],47:['5GB','Express 5GB',21.00],48:['6GB','Express 6GB',25.00],53:['7GB','Express 7GB',30.00],49:['8GB','Express 8GB',34.00],50:['10GB','Express 10GB',43.00],51:['15GB','Express 15GB',62.00],52:['20GB','Express 20GB',83.00],54:['25GB','Express 25GB',105.00],55:['30GB','Express 30GB',119.00],56:['40GB','Express 40GB',158.00],57:['50GB','Express 50GB',197.00]
  }},
  telecel: { network: 'Telecel', code: 'telecel', packages: {
    19:['10GB','TELECEL 10GB',40.00],20:['15GB','TELECEL 15GB',57.00],21:['20GB','TELECEL 20GB',77.00],22:['25GB','TELECEL 25GB',92.00],23:['30GB','TELECEL 30GB',110.00],24:['40GB','TELECEL 40GB',140.00],25:['50GB','TELECEL 50GB',178.00],26:['100GB','TELECEL 100GB',350.00]
  }},
  at_ishare: { network: 'AirtelTigo iShare', code: 'at_ishare', packages: {
    27:['1GB','AT-ISHARE 1GB',4.50],28:['2GB','AT-ISHARE 2GB',9.00],29:['3GB','AT-ISHARE 3GB',13.00],30:['4GB','AT-ISHARE 4GB',17.50],31:['5GB','AT-ISHARE 5GB',22.00],32:['6GB','AT-ISHARE 6GB',26.00],33:['7GB','AT-ISHARE 7GB',30.00],34:['8GB','AT-ISHARE 8GB',35.00],35:['9GB','AT-ISHARE 9GB',40.00],36:['10GB','AT-ISHARE 10GB',40.00],61:['15GB','AT-ISHARE 15GB',65.00],62:['20GB','AT-ISHARE 20GB',76.00]
  }}
};

const allowedOrigins = new Set([FRONTEND_URL, 'http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:3000']);
app.use(cors({ origin(origin, cb) { if (!origin || allowedOrigins.has(origin)) return cb(null, true); return cb(new Error('Origin not allowed by CORS')); }, methods:['GET','POST','OPTIONS'], allowedHeaders:['Content-Type'] }));
app.use('/api/paystack/webhook', express.raw({ type:'application/json', limit:'1mb' }));
app.use(express.json({ limit:'20kb' }));

const rateBuckets = new Map();
function rateLimit({ windowMs=60000, max=20 }={}) {
  return (req,res,next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || now - bucket.start > windowMs) bucket = { start:now, count:0 };
    bucket.count++; rateBuckets.set(key,bucket);
    if (bucket.count > max) return res.status(429).json({ success:false, message:'Too many requests. Please wait and try again.' });
    next();
  };
}
setInterval(() => { const now=Date.now(); for (const [k,v] of rateBuckets) if (now-v.start>120000) rateBuckets.delete(k); }, 60000).unref();
function makeOrderRef(){ return 'NDH-' + crypto.randomBytes(16).toString('hex').toUpperCase(); }
function validGhanaPhone(phone){ return typeof phone==='string' && /^0[235]\d{8}$/.test(phone); }
function safeCompareHex(a,b){ try { const x=Buffer.from(a,'hex'), y=Buffer.from(b,'hex'); return x.length===y.length && x.length>0 && crypto.timingSafeEqual(x,y); } catch { return false; } }
async function paystackRequest(path, method='GET', body=null){
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(), 15000);
  try {
    const response = await fetch(`https://api.paystack.co${path}`, { method, signal:controller.signal,
      headers:{ Authorization:`Bearer ${PAYSTACK_SECRET}`, 'Content-Type':'application/json' }, body:body?JSON.stringify(body):undefined });
    const data = await response.json().catch(()=>({message:'Invalid Paystack response'}));
    if (!response.ok || data.status===false) { const e=new Error(data.message||'Paystack request failed'); e.paystack=data; throw e; }
    return data;
  } finally { clearTimeout(timeout); }
}
async function datarjustPurchase({bundle_id,recipient,idempotency_key}){
  const controller = new AbortController(); const timeout=setTimeout(()=>controller.abort(),20000);
  try {
    const response=await fetch(`${DATARJUST_BASE}/purchase`,{method:'POST',signal:controller.signal,
      headers:{'X-API-Key':DATARJUST_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({bundle_id,recipient,idempotency_key})});
    const data=await response.json().catch(()=>({message:'Invalid DataJust response'}));
    if(!response.ok || data.status!=='success'){const e=new Error(data.message||data.error||'DataJust purchase failed');e.provider=data;throw e;}
    return data.data||{};
  } finally { clearTimeout(timeout); }
}
async function getOrder(order_ref){
  const {data,error}=await supabase.from('orders').select('*').eq('order_ref',order_ref).maybeSingle();
  if(error) throw error; return data;
}
function paymentMatches(verify,order){
  const d=verify?.data;
  return !!d && d.status==='success' && d.reference===order.order_ref &&
    Number(d.amount)===Math.round(Number(order.amount)*100) && String(d.currency||'').toUpperCase()==='GHS';
}
async function processPaidOrder(order_ref, paystackData){
  let order=await getOrder(order_ref);
  if(!order) return {notFound:true};
  if(!paymentMatches({data:paystackData},order)) return {invalidPayment:true};
  if(order.status==='delivered') return {order,alreadyDelivered:true};
  if(order.status==='processing') return {order,processing:true};
  // Mark payment as confirmed. Delivery is claimed atomically by the SQL RPC below.
  if(order.status==='pending_payment' || order.status==='payment_init_failed'){
    const {error}=await supabase.from('orders').update({status:'paid',paystack_reference:paystackData.reference})
      .eq('id',order.id).in('status',['pending_payment','payment_init_failed']);
    if(error) throw error;
    order=await getOrder(order_ref);
  }
  const {data:claimed,error:claimError}=await supabase.rpc('claim_order_delivery',{p_order_ref:order_ref});
  if(claimError) throw claimError;
  if(!claimed) return {order:await getOrder(order_ref),processing:true,alreadyClaimed:true};
  try {
    const delivered=await datarjustPurchase({bundle_id:order.bundle_id,recipient:order.recipient,idempotency_key:order.order_ref});
    const {data:updated,error}=await supabase.from('orders').update({status:'delivered',datarjust_order_id:String(delivered.order_id||''),datarjust_reference:delivered.reference||'',failure_reason:null}).eq('id',order.id).select().single();
    if(error) throw error;
    return {order:updated};
  } catch(providerError){
    console.error('DataJust delivery failed for',order_ref,providerError.message);
    const {error}=await supabase.from('orders').update({status:'delivery_failed',failure_reason:'Payment received. Data delivery is pending support/retry.'}).eq('id',order.id);
    if(error) console.error('Failed saving delivery error state:',error.message);
    return {order:await getOrder(order_ref),deliveryFailed:true};
  }
}


app.get('/api/health',(req,res)=>res.json({status:'ok',time:new Date().toISOString()}));
app.get('/api/config',(req,res)=>res.json({paystackPublicKey:PAYSTACK_PUBLIC}));
app.get('/',(req,res)=>res.status(200).json({service:'Nabeng Data Hub API',status:'ok',health:'/api/health'}));

app.post('/api/orders/create',rateLimit({max:8}),async(req,res)=>{
  try{
    const {bundle_id,network_code,recipient,email}=req.body||{};
    const network=CATALOGUE[network_code]; const pkg=network?.packages?.[Number(bundle_id)];
    if(!pkg) return res.status(400).json({success:false,message:'Unknown bundle. Refresh the page and select a valid package.'});
    if(!validGhanaPhone(recipient)) return res.status(400).json({success:false,message:'Invalid Ghanaian phone number. Use format 0XXXXXXXXX.'});
    if(email && (typeof email!=='string'||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return res.status(400).json({success:false,message:'Please provide a valid email address.'});
    const [size,label,price]=pkg; const order_ref=makeOrderRef();
    const {data:order,error:insertError}=await supabase.from('orders').insert({order_ref,bundle_id:Number(bundle_id),network:network.network,network_code,size,label,amount:price,recipient,email:email||null,status:'pending_payment'}).select().single();
    if(insertError){console.error('Order insert failed:',insertError.message);return res.status(500).json({success:false,message:'Could not create order.'});}
    const paystackBody={email:email||`${recipient}@nabengdatahub.com`,amount:Math.round(price*100),currency:'GHS',reference:order_ref,
      callback_url:`${FRONTEND_URL.replace(/\/$/,'')}/?payment=success&ref=${encodeURIComponent(order_ref)}`,
      metadata:{order_ref,bundle_id:Number(bundle_id),recipient,network:network.network,size,label}};
    try{
      const initialized=await paystackRequest('/transaction/initialize','POST',paystackBody);
      const {error:updateError}=await supabase.from('orders').update({paystack_reference:initialized.data.reference}).eq('id',order.id);
      if(updateError) console.error('Could not save Paystack reference:',updateError.message);
      return res.json({success:true,order_ref,authorization_url:initialized.data.authorization_url,access_code:initialized.data.access_code,public_key:PAYSTACK_PUBLIC});
    }catch(initError){
      await supabase.from('orders').update({status:'payment_init_failed',failure_reason:'Payment initialization failed. Please try again.'}).eq('id',order.id);
      console.error('Paystack initialize failed:',initError.message);
      return res.status(502).json({success:false,message:'Could not initialize payment. Please try again.'});
    }
  }catch(err){console.error('Order create error:',err.message);return res.status(500).json({success:false,message:'Server error while creating order.'});}
});


app.post('/api/paystack/webhook',async(req,res)=>{
  const signature=req.headers['x-paystack-signature'];
  if(!signature || !Buffer.isBuffer(req.body)) return res.sendStatus(400);
  const expected=crypto.createHmac('sha512',PAYSTACK_SECRET).update(req.body).digest('hex');
  if(!safeCompareHex(signature,expected)) return res.sendStatus(401);
  // Acknowledge a valid webhook, then perform verification and fulfillment.
  res.sendStatus(200);
  let event;
  try{event=JSON.parse(req.body.toString('utf8'));}catch{return;}
  if(event.event!=='charge.success' || !event.data?.reference) return;
  try{
    const reference=encodeURIComponent(event.data.reference);
    const verified=await paystackRequest(`/transaction/verify/${reference}`);
    const order=await getOrder(event.data.reference);
    if(!order){console.warn('Webhook order missing for ref:',event.data.reference);return;}
    if(!paymentMatches(verified,order)){console.warn('Verified payment did not match order:',order.order_ref);return;}
    const result=await processPaidOrder(order.order_ref,verified.data);
    if(result.deliveryFailed) console.warn('Payment verified but provider delivery failed:',order.order_ref);
  }catch(err){console.error('Webhook processing error:',err.message);}
});

app.get('/api/orders/:ref',rateLimit({max:30}),async(req,res)=>{
  try{
    const order=await getOrder(req.params.ref);
    if(!order) return res.status(404).json({success:false,message:'Order not found'});
    // Return only fields needed for tracking; never expose email/provider internals.
    const safe={order_ref:order.order_ref,status:order.status,size:order.size,label:order.label,network:order.network,amount:order.amount,recipient:order.recipient,datarjust_reference:order.datarjust_reference,created_at:order.created_at,failure_reason:order.failure_reason};
    return res.json({success:true,order:safe});
  }catch(err){console.error('Order status error:',err.message);return res.status(500).json({success:false,message:'Could not retrieve order status.'});}
});

app.post('/api/orders/verify',rateLimit({max:12}),async(req,res)=>{
  try{
    const order_ref=req.body?.order_ref;
    if(typeof order_ref!=='string'||!/^NDH-[A-F0-9]{32}$/.test(order_ref)) return res.status(400).json({success:false,message:'Invalid order reference.'});
    const order=await getOrder(order_ref);
    if(!order) return res.status(404).json({success:false,message:'Order not found.'});
    if(order.status==='delivered') {
      const safe={order_ref:order.order_ref,status:order.status,size:order.size,label:order.label,network:order.network,amount:order.amount,recipient:order.recipient,datarjust_reference:order.datarjust_reference,created_at:order.created_at,failure_reason:order.failure_reason};
      return res.json({success:true,order:safe,already_delivered:true});
    }
    const verify=await paystackRequest(`/transaction/verify/${encodeURIComponent(order_ref)}`);
    if(!paymentMatches(verify,order)) return res.json({success:false,message:'Payment is not confirmed for this order yet.',status:verify.data?.status||'unconfirmed'});
    const result=await processPaidOrder(order_ref,verify.data);
    if(result.invalidPayment) return res.status(400).json({success:false,message:'Payment verification did not match this order.'});
    if(result.notFound) return res.status(404).json({success:false,message:'Order not found.'});
    if(result.deliveryFailed) return res.status(502).json({success:false,message:'Payment received, but data delivery is delayed. Please contact support with your order reference.',order_ref});
    const current=await getOrder(order_ref);
    const safe={order_ref:current.order_ref,status:current.status,size:current.size,label:current.label,network:current.network,amount:current.amount,recipient:current.recipient,datarjust_reference:current.datarjust_reference,created_at:current.created_at,failure_reason:current.failure_reason};
    return res.json({success:true,order:safe,already_delivered:result.alreadyDelivered||false,processing:result.processing||false});
  }catch(err){console.error('Verify error:',err.message);return res.status(500).json({success:false,message:'Verification failed. Please try again shortly.'});}
});

app.listen(PORT,()=>console.log(`Nabeng Data Hub backend running on port ${PORT}`));
