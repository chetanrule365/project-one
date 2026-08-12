import { redirect } from "react-router";

/** Option Chain nav goes straight into a chain (default Nifty). */
export function loader() {
  return redirect("/option-chain/nifty");
}
