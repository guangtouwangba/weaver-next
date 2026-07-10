export function SettingRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div><strong>{title}</strong><p>{description}</p></div>
      {children}
    </div>
  );
}
