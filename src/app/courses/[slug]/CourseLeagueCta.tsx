"use client"
import Link from "next/link"
import { track } from "@/lib/analytics"

export function CourseLeagueCta({ href, entry, label }: { href: string; entry: string; label: string }) {
  return <Link href={href} onClick={() => track("league_cta_clicked", { entry_point: entry })} className="mt-4 inline-flex min-h-[48px] items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white">{label} <span className="ml-4" aria-hidden="true">↗</span></Link>
}
