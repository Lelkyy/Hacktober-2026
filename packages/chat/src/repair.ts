/**
 * Turns a messy chat line into words the intent parser already understands.
 * Quiet fixes (contractions, "mins", "gonna") stay invisible.
 * Loud fixes (a place or a verb was misspelled) come back as `heard`.
 */

const QUIET: [RegExp, string][] = [
  [/\b(gonna|gunna)\b/g, "going to"],
  [/\bwanna\b/g, "want to"],
  [/\bgotta\b/g, "got to"],
  [/\b(im|i'm)\b/g, "i'm"],
  [/\b(ive|i've)\b/g, "i've"],
  [/\b(dont|don't)\b/g, "don't"],
  [/\b(cant|can't)\b/g, "can't"],
  [/\b(wont|won't)\b/g, "won't"],
  [/\b(whats|what's)\b/g, "what is"],
  [/\b(wheres|where's)\b/g, "where is"],
  [/\b(hows|how's)\b/g, "how is"],
  [/\b(whens|when's)\b/g, "when is"],
  [/\b(lets|let's)\b/g, "let's"],
  [/\b(youre|you're)\b/g, "you're"],
  [/\b(thats|that's)\b/g, "that is"],
  [/\bidk\b/g, "i don't know"],
  [/\b(pls|plz)\b/g, "please"],
  [/\brn\b/g, "now"],
  [/\b(tmrw|tmro|tmr|2morrow|tommorow|tommorrow|tomorow|tomorrrow)\b/g, "tomorrow"],
  [/\b(2day|tday)\b/g, "today"],
  [/\b(2nite|tonite)\b/g, "tonight"],
  [/\bmins\b/g, "minutes"],
  [/\bmin\b/g, "minutes"],
  [/\b(hrs|hr)\b/g, "hours"],
  [/\bu\b/g, "you"],
  [/\b(cuz|cause)\b/g, "because"],
  [/\bpc\b/g, "price center"],
  [/\b(?:boutta|bouta|bout to)\b/g, "going to"],
  [/\b(?:imma|i'ma)\b/g, "i'm going to"],
  [/\bgimme\b/g, "give me"],
  [/\blemme\b/g, "let me"],
  [/\bits\b/g, "it's"],
  [/\b(?:tf|the fuck|the hell|the heck)\b/g, ""],
  [/\baf\b/g, ""],
  [/\b(?:ngl|tbh|fr|lowkey|highkey|lol|lmao|rofl)\b/g, ""],
  [/\bhit up\b/g, "go to"],
  [/\bswing by\b/g, "go to"],
  [/\bdrop by\b/g, "go to"],
  [/\bpop over to\b/g, "go to"],
  [/\bpop by\b/g, "go to"],
  [/\bhead over to\b/g, "heading to"],
  [/\brun over to\b/g, "go to"],
  [/\bmake it to\b/g, "go to"],
  [/\bget over to\b/g, "go to"],
  [/\bpull up to\b/g, "go to"],
  [/\bpull up at\b/g, "go to"],
  [/\bby way of\b/g, "via"],
  [/\bthru\b/g, "through"],
  [/\bnot far from\b/g, "near"],
  [/\bclose by\b/g, "nearby"],
  [/\bright by\b/g, "near"],
  [/\bright next to\b/g, "near"],
  [/\bhow far (?:is|to)\b/g, "how do i get to"],
  [/\bhow close (?:is|to)\b/g, "how do i get to"],
  [/\bdistance to\b/g, "how do i get to"],
  [/\bthe lib\b/g, "the library"],
  [/\blib\b/g, "library"],
];

/** Whole-word typos. Checked before fuzzy match so transpositions like "geisle" stay stable. */
const LOUD: Record<string, string> = {
  goign: "going", goin: "going", giong: "going", goig: "going", goinf: "going",
  rout: "route", routee: "route", rooute: "route",
  mur: "muir", muirr: "muir", muri: "muir",
  pinse: "pines", pinees: "pines",
  ventena: "ventanas", ventanna: "ventanas",
  bathrom: "bathroom", bathrm: "bathroom", bthroom: "bathroom", bathrooom: "bathroom", batrhoom: "bathroom",
  restrom: "restroom", restrrom: "restroom",
  geisle: "geisel", giesel: "geisel", geizel: "geisel", geisal: "geisel", geisell: "geisel", giesle: "geisel", geisl: "geisel",
  libary: "library", libray: "library", liberry: "library", libarary: "library",
  lecuture: "lecture", lectur: "lecture", lectrue: "lecture",
  discusion: "discussion", discssion: "discussion", discusson: "discussion",
  neerest: "nearest", nearst: "nearest", nerest: "nearest",
  closst: "closest", clostest: "closest",
  coffe: "coffee", cofee: "coffee", coffie: "coffee",
  gilmn: "gilman", gillman: "gilman", gilmam: "gilman",
  peppr: "pepper", peper: "pepper",
  canyone: "canyon", canyn: "canyon",
  centr: "center", centre: "center", cenetr: "center",
  warran: "warren", warrren: "warren",
  rimack: "rimac", rimmac: "rimac",
  foodworks: "foodworx", foodwox: "foodworx",
  oceanveiw: "oceanview", ocenview: "oceanview", oceanvue: "oceanview",
  revele: "revelle", revell: "revelle",
  hungrey: "hungry", hungy: "hungry",
  burito: "burrito", buritto: "burrito",
  sandwhich: "sandwich", sandwitch: "sandwich",
  schdule: "schedule", scedule: "schedule", schedual: "schedule",
  direcitons: "directions", directons: "directions", diretions: "directions", dirrections: "directions",
  wher: "where", hw: "how", wen: "when", wat: "what", whre: "where",
  clas: "class", clss: "class",
  gt: "get", frm: "from",
  bik: "bike", biek: "bike", wlk: "walk",
  shuttel: "shuttle", shutle: "shuttle", shuttl: "shuttle",
  troley: "trolley", trolly: "trolley",
  wheelchir: "wheelchair", wheelchar: "wheelchair",
  accesible: "accessible", accessable: "accessible",
  bycicle: "bicycle", bicyle: "bicycle",
  printe: "printer", printor: "printer",
  buss: "bus", nvm: "nevermind",
};

const FUZZY = [
  "geisel", "library", "muir", "pines", "ventanas", "bathroom", "restroom", "coffee", "gilman",
  "pepper", "canyon", "center", "warren", "rimac", "foodworx", "oceanview", "revelle", "hungry",
  "burrito", "schedule", "directions", "tomorrow", "today", "tonight", "minutes", "hours", "price",
  "college", "marshall", "bistro", "printer", "shuttle", "trolley", "wheelchair", "accessible",
  "bicycle", "parking", "clinic", "water", "lecture", "discussion", "nearest", "closest", "route",
  "going", "class", "from", "bike", "walk", "bus", "nevermind", "under", "dollar", "please", "help",
  "fastest", "quickest", "where", "when", "what", "how", "get", "food", "hall",
];

/** Words that must be left alone, including every fuzzy target. */
const PROTECT = new Set([
  ...FUZZY,
  "anything", "something", "everything", "nothing", "about", "there", "their", "which", "would",
  "could", "should", "want", "need", "have", "just", "like", "really", "this", "that", "with",
  "your", "time", "long", "much", "good", "best", "cheap", "open", "closed", "along", "path",
  "menu", "order", "wait", "ready", "pick", "drop", "take", "taking", "room", "stop", "next",
  "eat", "drink", "home", "dorm", "live", "start", "leave", "leaving", "arrive", "late", "early",
  "soon", "later", "morning", "night", "before", "after", "first", "then", "also", "maybe",
  "thanks", "hello", "sorry", "wrong", "again", "another", "around", "inside", "outside",
  "because", "near", "math", "phys", "chem", "econ", "biol", "cogs", "poli", "phil", "hist",
  "degrees", "between", "below", "above", "least", "most", "someone", "somewhere", "right",
  "left", "sixth", "ocean", "view", "matcha", "sandwich", "pizza", "pasta", "salad", "bowl",
  "noodles", "chicken", "latte", "boba", "tea", "bottle", "phone", "charge", "charger",
  "structure", "rack", "quiet", "computer", "doctor", "sick", "washer", "mailbox", "package",
  "dollars", "dollar", "bucks", "sandwich", "salad", "pizza", "boba", "matcha", "taco", "burger",
  "shower", "period", "tampon", "emergency", "urgent", "monday", "tuesday", "wednesday",
  "thursday", "friday", "saturday", "sunday", "noon", "midnight", "half", "hour", "minute",
  "classes", "course", "section", "seminar", "exam", "quiz", "walking", "biking", "buses",
  "transit", "stairs", "elevator", "step", "into", "onto", "over", "than", "them", "they",
  "will", "make", "made", "tell", "show", "find", "give", "back", "down", "only", "very",
  "some", "more", "less", "many", "each", "both", "such", "been", "being", "does", "did",
  "doing", "done", "having", "wants", "wanted", "needs", "looking", "thank", "here", "place",
  "places", "ways", "routes", "campus", "building", "stops", "last", "during", "while",
  "through", "without", "within", "still", "already", "yeah", "yep", "nope", "okay", "what",
  "where", "when", "your", "from", "have", "need", "want", "this", "that", "with", "just",
  "like", "good", "best", "much", "food", "hall", "near", "path", "stop", "next", "room",
  "walk", "bike", "bus", "class", "going", "route", "under", "please", "help", "today",
  "tomorrow", "tonight", "minutes", "hours", "library", "center", "price", "pepper", "canyon",
  "warren", "lecture", "geisel", "muir", "pines", "gilman", "coffee", "bathroom", "restroom",
  "hungry", "burrito", "shuttle", "trolley", "parking", "printer", "water", "clinic",
  "talk", "chat", "lost", "bored", "hate", "dead", "tired", "sleepy", "anywhere", "actually",
  "whatever", "stupid", "random", "joke", "funny", "always", "never", "delay", "weather",
  "rain", "essay", "homework", "laugh", "name", "thing", "stuff", "people", "figure",
]);

export function repair(raw: string): { text: string; heard?: string } {
  let text = raw
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [pattern, replacement] of QUIET) text = text.replace(pattern, replacement);
  text = text.replace(
    /\b(take me|takes me|get|go|going|walk|walking|bike|biking|head|heading|way|route|directions|bus|shuttle)\s+2\b/g,
    "$1 to",
  );
  const before = text;
  let loud = false;
  text = text.replace(/\bprice\s+cent(?:re|er|r)\b/g, (match) => {
    if (match !== "price center") loud = true;
    return "price center";
  });
  text = text.replace(/[a-z0-9']+/g, (word) => fixWord(word, () => (loud = true)));
  text = text.replace(/\s+/g, " ").trim();
  return { text, heard: loud && text !== before ? text : undefined };
}

function fixWord(word: string, mark: () => void): string {
  const mapped = LOUD[word];
  if (mapped) {
    if (mapped !== word) mark();
    return mapped;
  }
  // "dollars" is one edit from "dollar". A plural of a known word is already spelled right.
  if (word.length > 3 && word.endsWith("s") && PROTECT.has(word.slice(0, -1))) return word;
  const squeezed = word.replace(/(.)\1{2,}/g, "$1");
  if (squeezed !== word && (PROTECT.has(squeezed) || LOUD[squeezed])) {
    mark();
    return LOUD[squeezed] ?? squeezed;
  }
  if (word.length < 4 || word.length > 18 || /[^a-z]/.test(word) || PROTECT.has(word)) return word;
  const max = word.length >= 8 ? 2 : 1;
  let best = "";
  let bestD = max + 1;
  let ties = 0;
  for (const candidate of FUZZY) {
    if (candidate.length < 4 || Math.abs(candidate.length - word.length) > max) continue;
    const distance = damerau(word, candidate, max);
    if (distance === 0) return word;
    if (distance > max) continue;
    if (distance < bestD) {
      best = candidate;
      bestD = distance;
      ties = 1;
    } else if (distance === bestD && candidate !== best) ties += 1;
  }
  if (ties !== 1 || !best || best === word) {
    const place = guessPlace(word);
    if (!place) return word;
    mark();
    return place;
  }
  mark();
  return best;
}

/** Place names a few edits can still mean. Not ordinary words like "where" or "class". */
const PLACES = [
  "geisel", "library", "muir", "pines", "ventanas", "gilman", "pepper", "canyon", "warren",
  "rimac", "foodworx", "oceanview", "revelle", "marshall", "bistro",
];

/**
 * "Gisewel" is three edits from Geisel, past the one-edit fix above.
 * Only a unique place, sharing the first letter, and only when the word is not already English.
 */
function guessPlace(word: string): string | undefined {
  if (word.length < 6) return undefined;
  let best = "";
  let bestD = 4;
  let ties = 0;
  for (const candidate of PLACES) {
    if (candidate[0] !== word[0] || Math.abs(candidate.length - word.length) > 2) continue;
    const distance = damerau(word, candidate, 3);
    if (distance === 0 || distance > 3) continue;
    if (distance < bestD) {
      best = candidate;
      bestD = distance;
      ties = 1;
    } else if (distance === bestD && candidate !== best) ties += 1;
  }
  return ties === 1 && best ? best : undefined;
}

const SMALL = new Set(["the", "and", "for", "you", "are", "was", "but", "not", "can", "its", "too", "out", "all", "any", "our", "who", "why", "how", "yes", "she", "him", "her", "them", "they", "this", "that", "with", "have", "just"]);

/** A word the parser already treats as English or as a campus word. */
function knownWord(word: string): boolean {
  if (word.length <= 3) return true;
  return PROTECT.has(word) || SMALL.has(word) || !!LOUD[word] || /^\d+$/.test(word);
}

/**
 * Every longer word is nonsense ("giberish fheirfhoferhfieh").
 * A line that still has a real word, or a place we could estimate, is not gibberish.
 */
export function isGibberish(text: string): boolean {
  const words = text.toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter((word) => word.length >= 4);
  return words.length > 0 && words.every((word) => !knownWord(word));
}

/** Edit distance with adjacent transpositions counted as one. Stops past `max`. */
function damerau(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) d[i][0] = i;
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    let rowMin = d[i][0];
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let next = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) next = Math.min(next, d[i - 2][j - 2] + 1);
      d[i][j] = next;
      if (next < rowMin) rowMin = next;
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}
