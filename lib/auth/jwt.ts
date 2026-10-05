import { SignJWT, jwtVerify } from 'jose'

export interface UserJWTPayload {
  id: string
  email: string
  rol: string
  nombre: string
}

export interface DecodedDureyJWT {
  sub: string
  email: string
  rol: string
  nombre: string
}

// Solo para desarrollo local. Nunca usar la anon key (es pública) como secreto.
const DEV_SECRET = 'durey-dev-only-secret-no-usar-en-produccion'

function getSecretKey(): Uint8Array {
  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SUPABASE_JWT_SECRET no está configurado')
    }
    return new TextEncoder().encode(DEV_SECRET)
  }
  return new TextEncoder().encode(secret)
}

/**
 * Genera un token JWT estándar HS256 compatible con Supabase PostgREST y Next.js Edge Runtime.
 */
export async function generateSupabaseJWT(user: UserJWTPayload): Promise<string> {
  const secretKey = getSecretKey()

  return await new SignJWT({
    aud: 'authenticated',
    iss: 'supabase',
    sub: user.id,
    email: user.email,
    role: 'authenticated',
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
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secretKey)
}

/**
 * Verifica la firma criptográfica HMAC-SHA256 del JWT en memoria local (0 ms de red).
 * Compatible con Next.js Edge Runtime en Vercel.
 */
export async function verifySupabaseJWT(token: string): Promise<DecodedDureyJWT | null> {
  if (!token) return null
  try {
    const secretKey = getSecretKey()
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ['HS256']
    })

    const appMeta = (payload.app_metadata as Record<string, any>) || {}
    const userMeta = (payload.user_metadata as Record<string, any>) || {}
    const rol = appMeta.rol || userMeta.rol || ''
    const nombre = userMeta.name || (payload.email as string)?.split('@')[0] || 'Usuario'

    return {
      sub: payload.sub as string,
      email: (payload.email as string) || '',
      rol,
      nombre
    }
  } catch {
    return null
  }
}
