// ISO 3166-1 alpha-2 country list for the nationality/passport-issuing-country
// selector, built from the browser's own Intl data instead of a hardcoded
// list or a new dependency.
export interface CountryOption {
  code: string;
  name: string;
}

let cached: CountryOption[] | null = null;

export function getCountryOptions(): CountryOption[] {
  if (cached) return cached;
  if (typeof Intl.supportedValuesOf !== "function") {
    // Extremely old runtime without Intl.supportedValuesOf - degrade to a
    // plain text input instead of crashing (handled by callers checking length).
    return [];
  }
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    // TS's bundled Intl types don't include "region" as a supportedValuesOf
    // key yet, even though it's real ECMA-402 spec and supported at runtime -
    // same class of lag as React's ViewTransition types elsewhere in this repo.
    const supportedValuesOf = Intl.supportedValuesOf as (key: string) => string[];
    cached = supportedValuesOf("region")
      .filter((code) => /^[A-Z]{2}$/.test(code))
      .map((code) => ({ code, name: names.of(code) ?? code }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return cached;
  } catch {
    // Some runtimes expose Intl.supportedValuesOf but still throw for the
    // "region" key specifically (seen as `RangeError: Invalid key : region`) -
    // the function existing isn't a guarantee this particular key is
    // implemented, so this needs the same graceful degrade as the check above.
    return [];
  }
}
