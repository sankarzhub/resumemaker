import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { FileSearch, ShieldCheck, Sparkles, Wand2 } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { getErrorMessage } from '../api/axios'
import { Alert, TextField } from '../components/common/ui'
import { Logo } from '../components/common/Layout'

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
})

const registerSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(100),
    email: z.string().trim().email('Enter a valid email'),
    password: z
      .string()
      .min(8, 'At least 8 characters')
      .regex(/[A-Za-z]/, 'Include a letter')
      .regex(/[0-9]/, 'Include a number'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'Passwords do not match', path: ['confirm'] })

function HeroSide() {
  const features = [
    { icon: Wand2, title: 'Upload. Transform.', text: 'Drop any resume or document. Claude rewrites it into a sharp, ATS-friendly resume using only your real facts.' },
    { icon: FileSearch, title: 'ATS check', text: 'A transparent, rule-by-rule score with fixes you can act on.' },
    { icon: Sparkles, title: 'Job match', text: 'Paste a job description and see which skills you already prove, and which are missing.' },
    { icon: ShieldCheck, title: 'Your call', text: 'Every AI edit waits for your approval. Nothing is invented.' },
  ]
  return (
    <section className="speed-lines relative hidden overflow-hidden border-r-[3px] border-black bg-ink lg:flex lg:flex-col lg:justify-center lg:px-12">
      <div className="absolute -left-20 top-10 h-72 w-72 rounded-full bg-hero/30 blur-3xl" aria-hidden />
      <div className="absolute -right-10 bottom-10 h-72 w-72 rounded-full bg-bolt/30 blur-3xl" aria-hidden />
      <div className="relative">
        <span className="caption mb-4 text-sm">Chapter 1: Your next role</span>
        <h1 className="title-action title-glow text-6xl xl:text-7xl">
          Every hero
          <br />
          needs an <span className="text-gradient-hero">origin story.</span>
        </h1>
        <p className="mt-5 max-w-md text-lg text-slate-300">Turn yours into a resume that machines can read and recruiters remember.</p>
        <div className="mt-8 grid max-w-xl grid-cols-2 gap-4">
          {features.map((f, i) => (
            <div key={f.title} style={{ transform: `rotate(${i % 2 ? 0.8 : -0.8}deg)` }}>
              <div className="panel halftone animate-panel-in h-full p-4" style={{ animationDelay: `${120 + i * 90}ms` }}>
                <f.icon className="mb-2 h-6 w-6 text-gold" aria-hidden />
                <h3 className="font-display text-xl tracking-wide text-paper">{f.title}</h3>
                <p className="mt-1 text-sm text-slate-400">{f.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.15fr_1fr]">
      <HeroSide />
      <section className="flex flex-col items-center justify-center px-4 py-10">
        <div className="mb-8 lg:hidden">
          <Logo />
        </div>
        <div className="panel panel-glow-red w-full max-w-md animate-panel-in p-6 sm:p-8">
          <div className="bubble mb-6 inline-block">
            <h2 className="font-display text-3xl tracking-wide text-black">{title}</h2>
          </div>
          <p className="mb-6 text-sm text-muted">{subtitle}</p>
          {children}
        </div>
      </section>
    </div>
  )
}

export function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [serverError, setServerError] = useState('')
  const { register, handleSubmit, formState } = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) })
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard'

  if (user) return <Navigate to={from} replace />

  return (
    <AuthShell title="Welcome back!" subtitle="Log in to continue crafting your resume.">
      <form
        noValidate
        className="space-y-4"
        onSubmit={handleSubmit(async (v) => {
          setServerError('')
          try {
            await login(v.email, v.password)
            navigate(from, { replace: true })
          } catch (err) {
            setServerError(getErrorMessage(err))
          }
        })}
      >
        {serverError && <Alert>{serverError}</Alert>}
        <TextField label="Email" type="email" autoComplete="email" {...register('email')} error={formState.errors.email?.message} />
        <TextField label="Password" type="password" autoComplete="current-password" {...register('password')} error={formState.errors.password?.message} />
        <button type="submit" className="btn btn-hero w-full text-xl" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'Logging in…' : 'Log in'}
        </button>
        <p className="text-center text-sm text-muted">
          New here?{' '}
          <Link to="/register" className="font-semibold text-gold hover:underline">
            Create an account
          </Link>
        </p>
      </form>
    </AuthShell>
  )
}

export function RegisterPage() {
  const { user, register: signUp } = useAuth()
  const navigate = useNavigate()
  const [serverError, setServerError] = useState('')
  const { register, handleSubmit, formState } = useForm<z.infer<typeof registerSchema>>({ resolver: zodResolver(registerSchema) })

  if (user) return <Navigate to="/dashboard" replace />

  return (
    <AuthShell title="Join the story!" subtitle="Create a free account to build, check and export ATS-friendly resumes.">
      <form
        noValidate
        className="space-y-4"
        onSubmit={handleSubmit(async (v) => {
          setServerError('')
          try {
            await signUp(v.name, v.email, v.password)
            navigate('/dashboard', { replace: true })
          } catch (err) {
            setServerError(getErrorMessage(err))
          }
        })}
      >
        {serverError && <Alert>{serverError}</Alert>}
        <TextField label="Full name" autoComplete="name" {...register('name')} error={formState.errors.name?.message} />
        <TextField label="Email" type="email" autoComplete="email" {...register('email')} error={formState.errors.email?.message} />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="8+ characters with a letter and a number"
          {...register('password')}
          error={formState.errors.password?.message}
        />
        <TextField label="Confirm password" type="password" autoComplete="new-password" {...register('confirm')} error={formState.errors.confirm?.message} />
        <button type="submit" className="btn btn-hero w-full text-xl" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'Creating…' : 'Create account'}
        </button>
        <p className="text-center text-sm text-muted">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-gold hover:underline">
            Log in
          </Link>
        </p>
      </form>
    </AuthShell>
  )
}
