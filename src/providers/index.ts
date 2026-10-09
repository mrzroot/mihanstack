import type { Provider } from "../types.js";
import kavenegar from "./kavenegar.js";
import smsir from "./smsir.js";
import zarinpal from "./zarinpal.js";
import zibal from "./zibal.js";

export { kavenegar, smsir, zarinpal, zibal };

export const builtinProviders: Provider[] = [zarinpal, zibal, kavenegar, smsir];
