const formatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

export const formatUsd = (value: number): string => formatter.format(value);

export function Money({ value }: { value: number }) {
  return <span className="price">{formatUsd(value)}</span>;
}
