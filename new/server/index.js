require("dotenv").config();
const app = require("./app");

const PORT = process.env.PORT || 3000; // server hardcoded to run on port 3000. 

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} in ${process.env.NODE_ENV} mode.`);
}).on('error', error => {
  console.error('Error occurred starting the server: ', error);
});

process.on('SIGINT', () => {
  console.info('SIGINT signal received.');
  console.log('Closing http server.');
  server.close(() => {
    console.log('Http server closed.');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.info('SIGTERM signal received.');
  console.log('Closing http server.');
  server.close(() => {
    console.log('Http server closed.');
    process.exit(0);
  });
});
