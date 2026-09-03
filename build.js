// Build-time configuration for the static ClipForge app.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'index.html');
const OUT_DIR = path.join(__dirname, 'dist');
const OUT = path.join(OUT_DIR, 'index.html');

const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || 
                    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 
                    'sb_publishable_zRqpbpSxI3JDYAv4wnqajA_RJfLNcIX';

let html = fs.readFileSync(SRC, 'utf8');
html = html.split('__SUPABASE_PUBLISHABLE_KEY__').join(supabaseKey);
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, html);
console.log('[build] Wrote', OUT, '(with Supabase key)');