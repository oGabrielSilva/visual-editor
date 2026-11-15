const FEATURES: ReadonlySet<string> = new Set(['mso', 'ie']);
const COMPARISONS: ReadonlySet<string> = new Set(['gt', 'gte', 'lt', 'lte']);
const EXPRESSION_OPERATORS: ReadonlySet<string> = new Set(['!', '(', ')', '&', '|']);
const MAX_EXPRESSION_LENGTH = 100;

/**
 * Downlevel-revealed conditionals (`<![if !mso]>` ... `<![endif]>`) reach the tree as bogus
 * comments. Only the exact opening and closing forms over a closed vocabulary are recognized;
 * the content between the markers is ordinary markup validated like the rest of the document.
 */
export class DownlevelRevealedConditional {
  isOpening(value: string): boolean {
    if (value.length > MAX_EXPRESSION_LENGTH || !value.startsWith('[if ') || !value.endsWith(']'))
      return false;
    return this.validExpression(value.slice(4, -1));
  }

  isClosing(value: string): boolean {
    return value === '[endif]';
  }

  isMarker(value: string): boolean {
    return this.isOpening(value) || this.isClosing(value);
  }

  /**
   * `<![ENDIF]>` or `<![endif] >` would only survive as an ordinary comment, which no longer
   * closes the revealed block for Outlook. Anything but the exact closer is refused.
   */
  isClosingLookalike(value: string): boolean {
    return !this.isClosing(value) && value.trim().toLowerCase() === '[endif]';
  }

  /**
   * Document-order comment values: every revealed opener needs a later exact closer and a
   * second opener may not appear before it. A closer on its own stays an inert comment.
   */
  isBalanced(comments: Iterable<string>): boolean {
    let open = false;
    for (const value of comments) {
      if (this.isOpening(value)) {
        if (open) return false;
        open = true;
      } else if (this.isClosing(value)) open = false;
    }
    return !open;
  }

  /**
   * expression := term (('&' | '|') term)*
   * term       := ['!'] ('(' expression ')' | [gt | gte | lt | lte] (mso | IE) [version])
   */
  private validExpression(expression: string): boolean {
    const tokens = this.tokens(expression);
    if (!tokens?.length) return false;
    const end = this.expression(tokens, 0);
    return end === tokens.length;
  }

  private tokens(expression: string): readonly string[] | undefined {
    const tokens: string[] = [];
    let word = '';
    for (const character of expression) {
      if (character === ' ' || EXPRESSION_OPERATORS.has(character)) {
        if (word) tokens.push(word.toLowerCase());
        word = '';
        if (character !== ' ') tokens.push(character);
        continue;
      }
      const code = character.charCodeAt(0);
      const letter = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
      const digit = code >= 48 && code <= 57;
      if (!letter && !digit && character !== '.') return undefined;
      word += character;
    }
    if (word) tokens.push(word.toLowerCase());
    return tokens;
  }

  /** Index after the expression which starts at `start`, or -1 when none is well formed. */
  private expression(tokens: readonly string[], start: number): number {
    let index = this.term(tokens, start);
    while (index >= 0 && (tokens[index] === '&' || tokens[index] === '|'))
      index = this.term(tokens, index + 1);
    return index;
  }

  private term(tokens: readonly string[], start: number): number {
    let index = tokens[start] === '!' ? start + 1 : start;
    if (tokens[index] === '(') {
      const inner = this.expression(tokens, index + 1);
      return inner >= 0 && tokens[inner] === ')' ? inner + 1 : -1;
    }
    if (COMPARISONS.has(tokens[index] ?? '')) index++;
    if (!FEATURES.has(tokens[index] ?? '')) return -1;
    index++;
    return this.version(tokens[index] ?? '') ? index + 1 : index;
  }

  private version(value: string): boolean {
    const parts = value.split('.');
    return (
      parts.length <= 2 &&
      parts.every(
        (part) =>
          part.length > 0 &&
          part.length <= 3 &&
          [...part].every((digit) => digit.charCodeAt(0) >= 48 && digit.charCodeAt(0) <= 57),
      )
    );
  }
}
