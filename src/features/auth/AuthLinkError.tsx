import { Link } from 'react-router'

export function AuthLinkError({ message }: { message: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold text-slate-100">Email link unavailable</h1>
        <p role="alert" className="mt-4 rounded-lg border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
          {message}
        </p>
        <Link
          to="/sign-in"
          className="mt-6 inline-flex w-full justify-center rounded-lg bg-sky-600 px-3 py-2 font-medium text-white hover:bg-sky-500"
        >
          Return to sign in
        </Link>
      </div>
    </main>
  )
}
