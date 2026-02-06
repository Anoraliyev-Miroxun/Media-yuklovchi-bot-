import { config } from "dotenv";

const path =
  process.env.NODE_ENV === "development" ? ".env.development" : ".env";

config();

export const envConfig = {


  app: {
    port: +process.env.PORT || 4000,
    // nodeENV: process.env.NODE_ENV,
  },



  db: {
    port: +process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    dialect: process.env.DIALECT,
  },


  bot: {
    token: process.env.BOT_TOKEN,
  },


  email: {
    HOST: String(process.env.MAIL_HOST),
    PORT: Number(process.env.MAIL_PORT),
    USER: String(process.env.MAIL_USER),
    PASS: String(process.env.MAIL_PASS)
  },



};
