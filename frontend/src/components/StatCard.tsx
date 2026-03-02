interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  color?: "purple" | "green" | "blue" | "orange" | "red";
}

const colorMap = {
  purple: "border-purple-500/30 bg-purple-500/5",
  green:  "border-green-500/30  bg-green-500/5",
  blue:   "border-blue-500/30   bg-blue-500/5",
  orange: "border-orange-500/30 bg-orange-500/5",
  red:    "border-red-500/30    bg-red-500/5",
};

const dotMap = {
  purple: "bg-purple-400",
  green:  "bg-green-400",
  blue:   "bg-blue-400",
  orange: "bg-orange-400",
  red:    "bg-red-400",
};

export function StatCard({ label, value, sub, color = "purple" }: StatCardProps) {
  return (
    <div className={`rounded-xl border p-5 ${colorMap[color]}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full ${dotMap[color]}`} />
        <span className="text-xs text-gray-400 uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-bold text-white truncate">{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}
