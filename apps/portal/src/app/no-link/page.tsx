export default function NoLinkPage() {
  return (
    <main className="rounded-lg border border-line bg-surface p-6">
      <h1 className="text-lg font-semibold">You need a billing link to see this page</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        There is no sign-in here. This page opens from a link, so there is no password to remember and
        nothing to guess at — which also means the address on its own shows nothing.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Your link is in any billing email you have been sent, or in your account on the site you subscribed
        through.
      </p>
    </main>
  );
}
