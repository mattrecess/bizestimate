// Account plans: free | pro | unlimited. "unlimited" is everything in Pro with no caps at all (searches,
// contact lookups), for the site's owner and team, set by hand on /admin -> Users.
export const isPro = (plan?: string | null) => plan === "pro" || plan === "unlimited";
export const isUnlimited = (plan?: string | null) => plan === "unlimited";
