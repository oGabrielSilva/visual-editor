import * as v from 'valibot';

export interface NumericStyle {
  readonly amount: number;
  readonly unit: string;
}

/** Numeric controls preserve unsupported CSS until the user changes the value. */
export class NumericStyleValue {
  constructor(
    private readonly units: readonly string[],
    private readonly minimum = 0,
    private readonly maximum = 10000,
    private readonly maximumByUnit: Readonly<Record<string, number>> = {},
  ) {}

  parse(input: string): NumericStyle | undefined {
    const match = /^(-?(?:\d+\.?\d*|\.\d+))(px|em|rem|%|vh|vw)?$/.exec(input.trim());
    if (!match) return undefined;
    const amount = Number(match[1]);
    const unit = match[2] ?? '';
    return this.valid(amount, unit) ? { amount, unit } : undefined;
  }

  create(amount: string, unit: string): string | undefined {
    if (!amount.trim()) return undefined;
    const number = Number(amount);
    return this.valid(number, unit) ? `${number}${unit}` : undefined;
  }

  private valid(amount: number, unit: string): boolean {
    return (
      v.safeParse(
        v.pipe(
          v.number(),
          v.finite(),
          v.minValue(this.minimum),
          v.maxValue(this.maximumByUnit[unit] ?? this.maximum),
        ),
        amount,
      ).success && this.units.includes(unit)
    );
  }
}
