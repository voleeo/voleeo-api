export function BodyCard({ text }: { text: string }) {
  return (
    <div className="px-3 py-2.5 bg-bg border border-border rounded-[5px]">
      <pre className="m-0 font-mono text-[0.857rem] leading-[1.6] text-muted whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto">
        {text}
      </pre>
    </div>
  )
}
