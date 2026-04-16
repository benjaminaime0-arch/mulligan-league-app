import { redirect } from "next/navigation"

// The profile page is now the home page.
// Kept as a safety net so any old bookmarks or external links to /dashboard
// still land the user on the right screen.
export default function DashboardPage() {
  redirect("/profile")
}
