import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Privacy policy for Mulligan League. Learn how we collect, use, and protect your data.",
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-6 text-3xl font-bold text-primary">Privacy Policy</h1>
      <p className="mb-8 text-sm text-gray-500">Last updated: March 20, 2026</p>

      <div className="space-y-8 text-gray-700">
        <section>
          <h2 className="mb-3 text-xl font-semibold text-primary">
            1. Information We Collect
          </h2>
          <p>
            When you create an account on Mulligan League, we collect your name,
            email address, and any profile information you choose to provide. We
            also collect data about your league activity, including scores,
            match results, and league memberships.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-primary">
            2. How We Use Your Information
          </h2>
          <p>
            We use your information to operate and improve Mulligan League,
            including managing your account, displaying leaderboards, tracking
            match results, and communicating with you about your leagues. We do
            not sell your personal information to third parties.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-primary">
            3. Data Storage and Security
          </h2>
          <p>
            Your data is stored securely using industry-standard encryption and
            hosted on trusted cloud infrastructure. We take reasonable measures
            to protect your information from unauthorized access, alteration, or
            destruction.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-primary">
            4. Cookies
          </h2>
          <p>
            Mulligan League uses essential cookies to keep you signed in and
            remember your preferences. We may also use analytics cookies to
            understand how our service is used and improve the experience.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-primary">
            5. Your Rights
          </h2>
          <p>
            You can access, update, or delete your personal information at any
            time from your profile settings. If you wish to delete your account
            entirely, please contact us and we will remove your data within 30
            days.
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-xl font-semibold text-primary">
            6. Contact Us
          </h2>
          <p>
            If you have questions about this privacy policy, please contact us
            at{" "}
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
