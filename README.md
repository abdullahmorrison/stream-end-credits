# ci-demo

Generated images only. Every pull request that touches the credits gets its reel
rendered by `.github/workflows/demo.yml` and the pictures pushed here, so the
pull request can show them inline.

Nothing here is source and nothing reads it back. The branch is force-pushed as a
single commit each time, so it never accumulates history; delete it and the next
run makes it again.
