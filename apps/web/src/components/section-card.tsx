interface SectionCardProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  titleIsRaw?: boolean;
  descriptionIsRaw?: boolean;
}

export function SectionCard({ title, description, action, children, titleIsRaw = false, descriptionIsRaw = false }: SectionCardProps) {
  return (
    <section className="card card-pad">
      <div className="section-title">
        <div>
          <h2 {...(titleIsRaw ? { "data-language-raw": true } : {})}>{title}</h2>
          {description ? <p {...(descriptionIsRaw ? { "data-language-raw": true } : {})}>{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
