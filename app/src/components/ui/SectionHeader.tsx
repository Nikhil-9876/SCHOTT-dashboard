interface Props {
  children: string;
}

export default function SectionHeader({ children }: Props) {
  return <div className="section-header">{children}</div>;
}
