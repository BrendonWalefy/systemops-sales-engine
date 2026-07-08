import "dotenv/config";
import { signToken } from "../src/lib/session";

async function main() {
  const token = await signToken({
    email: "helena@odontomarques.com.br",
    role: "org_admin",
    memberRole: "org_admin",
    professionalId: null,
  });
  console.log("COOKIE=" + token);
  process.exit(0);
}
main();
