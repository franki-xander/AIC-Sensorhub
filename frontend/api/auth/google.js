
// =============================================================================
// GOOGLE OAUTH ROUTES
// =============================================================================

router.get("/google",
  passport.authenticate("google", { scope: ["profile", "email"], session: false })
);


