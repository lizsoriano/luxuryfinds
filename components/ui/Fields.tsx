import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function Input({ label, id, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label className="field" htmlFor={id}><span>{label}</span><input className="input" id={id} {...props} /></label>;
}
export function Select({ label, id, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return <label className="field" htmlFor={id}><span>{label}</span><select className="input select" id={id} {...props}>{children}</select></label>;
}
export function Textarea({ label, id, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return <label className="field" htmlFor={id}><span>{label}</span><textarea className="input textarea" id={id} {...props} /></label>;
}
