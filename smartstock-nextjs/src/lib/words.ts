// Produce names are a mix of plurals ("Tomatoes") and mass nouns ("Lettuce"); sentences need the right verb.
export const isPlural = (label: string) => /s$/i.test(label.trim());

/** verb("Tomatoes", "are", "is") -> "are"; verb("Lettuce", "are", "is") -> "is" */
export const verb = (label: string, plural: string, singular: string) => (isPlural(label) ? plural : singular);

/** "1 item" / "3 items" */
export const count = (n: number, noun: string, pluralNoun = `${noun}s`) => `${n} ${n === 1 ? noun : pluralNoun}`;
