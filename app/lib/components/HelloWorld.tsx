import Box from "@mui/joy/Box";
import Divider from "@mui/joy/Divider";
import Link from "@mui/joy/Link";
import Sheet from "@mui/joy/Sheet";
import Tooltip from "@mui/joy/Tooltip";
import Typography from "@mui/joy/Typography";

export default function HelloWorld() {
  return (
    <Tooltip
      arrow
      open
      placement="bottom"
      title={
        <Sheet
          variant="outlined"
          sx={{
            px: 2,
            py: 1,
          }}
        >
          <Typography level="h4" component="h1">
            This is an example <Link href="https://remix.run/">Remix</Link> app
          </Typography>
          <Typography sx={{ fontWeight: 700 }} level="h5">
            It is deployed on Kubernetes 🎉
          </Typography>
          <Divider sx={{ my: 1 }} />

          <Typography
            endDecorator={
              <Link href="https://kaibun.net/articles/2023-02-25-deploying-remix-to-kubernetes">
                Read the tutorial
              </Link>
            }
            sx={{ alignSelf: "center" }}
          >
            Interested?
          </Typography>
        </Sheet>
      }
    >
      <Box sx={{ width: 400 }} />
    </Tooltip>
  );
}
