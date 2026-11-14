import { Link } from "react-router-dom";

export function Brand({ className = "" }: { className?: string }) {
  return (
    <Link to="/" className={`brand ${className}`.trim()}>
      <img src="/agrona-logo.png" alt="AGRONA" width={1536} height={1024} />
    </Link>
  );
}
