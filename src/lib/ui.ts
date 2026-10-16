const focus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2";
const motion = "transition duration-150 disabled:cursor-default disabled:opacity-60";
const shape = "inline-flex h-9 items-center justify-center rounded-lg px-3 text-sm font-medium";

export const buttonPrimary = `${shape} bg-navy text-white shadow-sm hover:bg-[#16366e] ${motion} ${focus}`;
export const buttonSecondary = `${shape} border border-slate-300 bg-white text-navy shadow-sm hover:bg-slate-50 ${motion} ${focus}`;
export const buttonQuiet = `${shape} bg-transparent text-slate-600 hover:bg-slate-100 hover:text-navy ${motion} ${focus}`;
export const buttonDanger = `${shape} bg-red-700 text-white shadow-sm hover:bg-red-800 ${motion} ${focus}`;

export const navLink =
  "border-b-2 font-medium transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A1E41]";
