import React from "react";
import { getSortedLanguages } from "../lib/languages";
import { useUserStore } from "../lib/store";

interface Props {
  /** Optional filter to exclude certain language codes */
  exclude?: string[];
}

/** Renders <option> elements grouped by favorites + all others, for use inside <select> */
export function LanguageOptions({ exclude }: Props) {
  const { favoriteLanguages } = useUserStore();
  const { favorites, rest } = getSortedLanguages(favoriteLanguages);

  const filterFn = exclude?.length
    ? (l: { code: string }) => !exclude.includes(l.code)
    : () => true;

  const favFiltered = favorites.filter(filterFn);
  const restFiltered = rest.filter(filterFn);

  if (favFiltered.length === 0) {
    return (
      <>
        {restFiltered.map((l) => (
          <option key={l.code} value={l.code}>
            {l.flag} {l.label}
          </option>
        ))}
      </>
    );
  }

  return (
    <>
      <optgroup label="★">
        {favFiltered.map((l) => (
          <option key={l.code} value={l.code}>
            {l.flag} {l.label}
          </option>
        ))}
      </optgroup>
      <optgroup label="───">
        {restFiltered.map((l) => (
          <option key={l.code} value={l.code}>
            {l.flag} {l.label}
          </option>
        ))}
      </optgroup>
    </>
  );
}
