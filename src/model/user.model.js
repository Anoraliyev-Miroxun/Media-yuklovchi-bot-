import {DataTypes} from 'sequelize';
import {sequelize} from '../db/index.js';

export const User=sequelize.define("users",{
    telegram_id:{
        type:DataTypes.BIGINT,
        primaryKey:true,
        autoIncrement:false,
        required:true,
        unique:true
    },

    username:{
        type:DataTypes.STRING,
        unique:true,
        required:true
    },

    first_name:{
        type:DataTypes.STRING,
    },

    language_code:{
        type:DataTypes.STRING,
        defaultValue:"uz"
    },
    phone_number:{
        type:DataTypes.STRING
    },
    email:{
        type:DataTypes.STRING
    }

})