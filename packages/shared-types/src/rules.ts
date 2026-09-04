export const CARNAVAL_2027_RULES = {
  votingNights: 3,
  totalJudges: 9,
  judgesPerNight: 3,
  specialtiesPerNight: [
    "BAILE",
    "VESTUARIO",
    "BATERIA",
  ] as const,
  judgesPerSpecialtyPerNight: 1,
  scoreMin: 0,
  scoreMax: 10,
  omissionScore: 5,
  discardHighest: 0,
  discardLowest: 0,
  randomRubrosCountTowardComparsaWinner: false,
  confirmedVotesMutable: false,
} as const;