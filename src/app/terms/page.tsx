import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "Terms of service for Mulligan League. Read the rules and guidelines for using our platform.",
}

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-6 text-3xl font-bold text-primary">Terms of Service</h1>
      <p className="mb-8 text-sm text-gray-500">Effective: March 20, 2026</p>

      <div className="space-y-8 text-gray-700">
        <section>
          <h2 className="mb-3 text-xl font-semibold text-primary">
            1. Acceptance of Terms
          </h2>
          <p>
            By creating an account or using Mulligan League, you agree to these
            terms of service. If you do not agree, please do not use the
            service.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-primary">
            2. Description of Service
          </h2>
          <p>
            Mulligan League is a free platform that allows golfers to create
            private leagues, log scores, track leaderboards, and organize
            weekly matches with their golf group.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-primary">
            3. User Accounts
          </h2>
          <p>
            You are responsible for maintaining the security of your account
            credentials. You must provide accurate information when creating
            your account. You may not use another person&apos;s account without
            permission.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-primary">
            4. Acceptable Use
          </h2>
          <p>
            You agree to use Mulligan League for its intended purpose —
            organizing and tracking golf leagues. You may not use the service
            for any unlawful purpose, spam other users, or attempt to interfere
            with the platform&apos;s operation.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-primary">
            5. Content and Scores
          </h2>
          <p>
            You are responsible for the accuracy of the scores and information
            you submit. Mulligan League is not responsible for disputes between
            league members regarding scores or standings.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-primary">
            6. Termination
          </h2>
          <p>
            We reserve the right to suspend or terminate accounts that violate
            these terms. You may delete your account at any time from your
            profile settings.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-primary">
            7. Limitation of Liability
          </h2>
          <p>
            Mulligan League is provided &quot;as is&quot; without warranties of
            any kind. We are not liable for any damages arising from your use
            of the service.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-primary">
            8. Contact
          </h2>
          <p>
            Questions about these terms? Contact us at{" "}
            <a
              href="mailto:hello@mulliganleague.com"
              className="text-accent underline hover:text-accent/80"
            >
              hello@mulliganleague.com
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  )
}
