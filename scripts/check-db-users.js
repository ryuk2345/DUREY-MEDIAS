const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

// Manual env parser to avoid dependency issues
const envPath = path.resolve(__dirname, '../.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
const env = {}
envContent.split('\n').forEach(line => {
  if (line && !line.startsWith('#')) {
    const parts = line.split('=')
    if (parts.length >= 2) {
      env[parts[0].trim()] = parts.slice(1).join('=').trim()
    }
  }
})

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Error: missing Supabase credentials in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function run() {
  console.log('Connecting to:', supabaseUrl)
  const { data, error } = await supabase.from('usuarios').select('*')
  if (error) {
    console.error('Error fetching users:', error.message)
  } else {
    console.log('Users in database:', data)
  }
}

run()
