import {User} from '../model/user.model.js';

class UserService{
    async create(userData){
        try {
            const createNewUser=await User.create({
                telegram_id:+userData.id,
                username:userData.username,
                first_name:userData.first_name
            });
            console.log("yangi user create boldi");

        } catch (error) {
            console.log("user.service.js da hato chiqdi",error.message);
        }
    }

    async getById(id){
        try {
            return await User.findByPk(id);
        } catch (error) {
            console.log("user.service.js da hato chiqdi",error.message);
        }
    }

    async update(id,userData){
        try {
            await User.update({...userData},{where:{telegram_id:id}});
            console.log("user malumotlari yangilandi");
        } catch (error) {
            console.log("user.service.js da hato chiqdi",error.message);
        }
    }


}

export default new UserService();
