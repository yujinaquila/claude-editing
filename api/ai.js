export default async function handler(req,res){
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});
  if(!process.env.ANTHROPIC_API_KEY) return res.status(503).json({error:'AI is not configured. Add ANTHROPIC_API_KEY in Vercel.'});
  try{
    const {content,maxTokens=1200}=req.body||{};
    const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:process.env.ANTHROPIC_MODEL||'claude-sonnet-4-6',max_tokens:maxTokens,messages:[{role:'user',content}]})});
    const data=await r.json();
    if(!r.ok) return res.status(r.status).json({error:data?.error?.message||'AI request failed'});
    const text=(data.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');
    res.status(200).json({text});
  }catch(e){res.status(500).json({error:e?.message||'AI service failed'});}
}
