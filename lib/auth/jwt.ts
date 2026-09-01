import crypto from 'crypto'

interface UserJWTPayload {
  id: string
  email: string
  rol: string
  nombre: string
}

function base64UrlEncode(data: string | Buffer): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

/**
 * Genera un token JWT estándar HS256 compatible con Supabase PostgREST.
 * Utiliza SUPABASE_JWT_SECRET para firmar la petición.
 */
export function generateSupabaseJWT(user: UserJWTPayload): string {
  const secret = process.env.SUPABASE_JWT_SECRET || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'durey-secret-jwt-key-2026'

  const header = {
    alg: 'HS256',
    typ: 'JWT'
  }

  const now = Math.floor(Date.now() / 1000)
  const oneWeek = 60 * 60 * 24 * 7 // 7 días

  const payload = {
    aud: 'authenticated',
    exp: now + oneWeek,
    iat: now,
    iss: 'supabase',
    sub: user.id,
    email: user.email,
    role: 'authenticated', // 👈 Rol fundamental para que PostgREST cambie de 'anon' a 'authenticated'
    app_metadata: {
      provider: 'email',
      providers: ['email'],
      rol: user.rol
    },
    user_metadata: {
      name: user.nombre,
      rol: user.rol,
      sub: user.id
    }
  }

  const encodedHeader = base64UrlEncode(JSON.stringify(header))
  const encodedPayload = base64UrlEncode(JSON.stringify(payload))
  const tokenData = `${encodedHeader}.${encodedPayload}`

  const signature = crypto
    .createHmac('sha256', secret)
    .update(tokenData)
    .digest()

  const encodedSignature = base64UrlEncode(signature)

  return `${tokenData}.${encodedSignature}`
}
