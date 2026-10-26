/** A file's text, as Vite (and Vitest) import it with `?raw`. The apps get this from vite/client. */
declare module "*?raw" {
  const text: string;
  export default text;
}
