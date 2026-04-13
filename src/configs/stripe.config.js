import Stripe from "stripe";

// eslint-disable-next-line no-undef
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is missing in environment variables");
}

// eslint-disable-next-line no-undef
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  // timeout: 10000,
  maxNetworkRetries: 3,
});
