import { useEffect, useState } from 'react'
import { api } from '@/lib/api'

type Kind = 'privacy' | 'terms'

interface Props { kind: Kind }

const UPDATED = '17 November 2026'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="display text-lg font-bold" style={{ color: 'var(--ink)' }}>{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>{children}</div>
    </section>
  )
}

function Privacy({ contact }: { contact: string }) {
  return (
    <>
      <Section title="Who we are">
        <p>UBQ Global Marketplace is a marketplace where people list and buy goods and services and pay in USDC. This notice explains what personal data the app handles and why. The app currently runs on a test network, so no real money moves.</p>
      </Section>
      <Section title="What we collect">
        <ul className="list-disc space-y-1 pl-5">
          <li>Your wallet address. It is your account identity and it is public on the blockchain.</li>
          <li>Your sign-in method. If you sign in with email or Google, our wallet provider (Circle) checks your email and creates your wallet. We do not store your email address.</li>
          <li>Profile details you choose to add, such as a display name, shop name, bio and country.</li>
          <li>Listings, orders, reports and messages you create in the app, including payment transaction references.</li>
          <li>Security data: a random device ID kept in your browser, a one-way hash of your device and network address, a shortened browser description, and sign-in and security events.</li>
          <li>Your acceptance of this notice and the terms, with the time you agreed.</li>
        </ul>
      </Section>
      <Section title="Why we use it">
        <p>To run your account, show your listings, process and verify payments, prevent fraud and abuse, keep accounts secure, and meet legal duties. We do not sell your data and we do not use it for advertising.</p>
      </Section>
      <Section title="Who handles it for us">
        <ul className="list-disc space-y-1 pl-5">
          <li>Circle: wallet creation and email or Google sign-in.</li>
          <li>Google: only if you choose Continue with Google.</li>
          <li>Neon: the database that stores app data.</li>
          <li>Vercel: hosting.</li>
          <li>The Arc blockchain: payments are public and permanent by design and cannot be deleted.</li>
        </ul>
      </Section>
      <Section title="Identity documents">
        <p>The app does not collect or store identity documents. If identity checks are added later, only the provider's reference and result will be kept, and this notice will be updated first.</p>
      </Section>
      <Section title="How long we keep it">
        <p>Sign-in sessions last up to 7 days. Security events and risk records are kept for up to 12 months. Payment records are kept for the period the law requires. Staff actions are kept in a tamper-evident audit log.</p>
      </Section>
      <Section title="Your choices">
        <p>After signing in, open Security in your account menu to see your sessions and activity, download your data, sign devices out, or request deletion. Deletion removes your profile details. Payment records and blockchain data stay.</p>
        <p>Depending on where you live (for example Nigeria, the EU or UK, or a US state with a privacy law), you may have further rights, including access, correction and complaint to a regulator. Contact us to use them.</p>
      </Section>
      <Section title="Contact">
        <p>{contact}</p>
      </Section>
      <p className="mt-8 rounded-xl border p-3 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
        This notice describes how the app works today. It is a working draft for a test-network product and has not been reviewed by a lawyer. It should be reviewed before real money is used.
      </p>
    </>
  )
}

function Terms({ contact }: { contact: string }) {
  return (
    <>
      <Section title="Using the marketplace">
        <p>By signing in you agree to these terms. You must be old enough to form a contract where you live and you must follow the law that applies to you. The app currently runs on a test network. Test tokens have no value and nothing here is financial advice.</p>
      </Section>
      <Section title="Prohibited items and conduct">
        <p>You must not list or sell anything illegal, stolen or counterfeit, including fake identity documents, forged visas or passports, weapons, drugs, or anything that breaks sanctions or export laws. You must not harass others, post false listings, manipulate reviews or payments, or try to break or misuse the service.</p>
        <p>Listings that look risky are held for review. Accounts can be restricted after review, and you can appeal. Illegal activity may be reported to the authorities.</p>
      </Section>
      <Section title="Buying and selling">
        <p>Sellers are responsible for their listings and for delivering what they describe. Payments are made in USDC from your wallet and cannot be reversed by us. Check the seller, price and details before paying. Use escrow where it is offered for larger or riskier purchases.</p>
      </Section>
      <Section title="Your wallet">
        <p>Wallets created for you are controlled by you through your PIN. If you lose your sign-in method or PIN, nobody, including us, can recover your wallet or funds. Keep your PIN and recovery answers safe.</p>
      </Section>
      <Section title="No guarantees">
        <p>The service is provided as it is, without promises of availability or accuracy. To the extent the law allows, we are not liable for losses from your use of the marketplace, third-party services, or blockchain networks.</p>
      </Section>
      <Section title="Changes and contact">
        <p>We may update these terms and will show the new version here. {contact}</p>
      </Section>
      <p className="mt-8 rounded-xl border p-3 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
        This is a working draft for a test-network product and has not been reviewed by a lawyer. It should be reviewed before real money is used.
      </p>
    </>
  )
}

export function LegalPage({ kind }: Props) {
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    document.title = kind === 'privacy' ? 'Privacy Notice | UBQ Global Marketplace' : 'Terms of Use | UBQ Global Marketplace'
    let live = true
    api<{ contactEmail?: string | null }>('/config', { auth: false })
      .then(c => { if (live) setEmail(c.contactEmail ?? null) })
      .catch(() => { /* the page works without it */ })
    return () => { live = false }
  }, [kind])

  const contact = email ? `Questions or requests: ${email}.` : 'Questions or requests: use the report options inside the app.'

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <main className="mx-auto max-w-2xl px-5 py-10">
        <a href="/" className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>Back to UBQ Global Marketplace</a>
        <h1 className="display mt-4 text-3xl font-bold" style={{ color: 'var(--ink)' }}>
          {kind === 'privacy' ? 'Privacy Notice' : 'Terms of Use'}
        </h1>
        <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>Last updated {UPDATED}</p>
        {kind === 'privacy' ? <Privacy contact={contact} /> : <Terms contact={contact} />}
        <nav className="mt-10 flex gap-4 text-sm font-semibold" style={{ color: 'var(--accent)' }}>
          <a href="/privacy">Privacy Notice</a>
          <a href="/terms">Terms of Use</a>
        </nav>
      </main>
    </div>
  )
}
