/** Pending submissions follow the current card's next required action. */
export function personalSubmissionStatusKey(submissionStatus: string, cardStatus: string): string {
  if (submissionStatus === "pending" && cardStatus === "pending_player_confirmation") {
    return "personal.submission.awaitingPlayer"
  }
  return `personal.submission.${submissionStatus}`
}
