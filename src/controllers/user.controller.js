const UserModel = require("../models/user.model.js");
const CartModel = require("../models/cart.model.js");
const jwt = require("jsonwebtoken");
const { createHash, isValidPassword } = require("../utils/hashbcryp.js");
const UserDTO = require("../dto/user.dto.js");
const { generateResetToken } = require("../utils/tokenreset.js");

// Repositorio de usuarios
const UserRepository = require("../repositories/user.repository.js");
const userRepository = new UserRepository();

// Servicio de envío de correos electrónicos
const EmailManager = require("../services/email.js");
const emailManager = new EmailManager();

class UserController {
    async register(req, res) {
        const { first_name, last_name, email, password, age } = req.body;
        try {
            const existeUsuario = await userRepository.findByEmail(email);
            if (existeUsuario) {
                return res.status(400).send("El usuario ya existe");
            }

            // Creo un nuevo carrito
            const nuevoCarrito = new CartModel();
            await nuevoCarrito.save();

            const nuevoUsuario = new UserModel({
                first_name,
                last_name,
                email,
                cart: nuevoCarrito._id,
                password: createHash(password),
                age
            });

            await userRepository.create(nuevoUsuario);

            const token = jwt.sign({ user: nuevoUsuario }, "coderhouse", {
                expiresIn: "1h"
            });

            res.cookie("coderCookieToken", token, {
                maxAge: 3600000,
                httpOnly: true
            });

            res.redirect("/api/users/profile");
        } catch (error) {
            console.error("Error en el registro de usuario:", error);
            res.status(500).send("Error interno del servidor");
        }
    }

    async login(req, res) {
        const { email, password } = req.body;
        try {
            const usuarioEncontrado = await userRepository.findByEmail(email);

            if (!usuarioEncontrado) {
                return res.status(401).send("Usuario no válido");
            }

            const esValido = isValidPassword(password, usuarioEncontrado);
            if (!esValido) {
                return res.status(401).send("Contraseña incorrecta");
            }

            const token = jwt.sign({ user: usuarioEncontrado }, "coderhouse", {
                expiresIn: "1h"
            });

            // Actualizar la propiedad last_connection
            usuarioEncontrado.last_connection = new Date();
            await usuarioEncontrado.save();

            res.cookie("coderCookieToken", token, {
                maxAge: 3600000,
                httpOnly: true
            });

            res.redirect("/api/users/profile");
        } catch (error) {
            console.error("Error en el inicio de sesión:", error);
            res.status(500).send("Error interno del servidor");
        }
    }

    async profile(req, res) {
        try {
            const isPremium = req.user.role === 'premium';
            const userDto = new UserDTO(req.user.first_name, req.user.last_name, req.user.role);
            const isAdmin = req.user.role === 'admin';

            res.render("profile", { user: userDto, isPremium, isAdmin });
        } catch (error) {
            res.status(500).send('Error interno del servidor');
        }
    }

    async logout(req, res) {
        if (req.user) {
            try {
                // Actualizar la propiedad last_connection
                req.user.last_connection = new Date();
                await req.user.save();
            } catch (error) {
                console.error("Error al actualizar last_connection:", error);
                res.status(500).send("Error interno del servidor");
                return;
            }
        }

        res.clearCookie("coderCookieToken");
        res.redirect("/login");
    }

    async admin(req, res) {
        if (req.user.role !== "admin") {
            return res.status(403).send("Acceso denegado");
        }
        res.render("admin");
    }

    async requestPasswordReset(req, res) {
        const { email } = req.body;

        try {
            // Buscar al usuario por su correo electrónico
            const user = await userRepository.findByEmail(email);
            if (!user) {
                return res.status(404).send("Usuario no encontrado");
            }

            // Generar un token 
            const token = generateResetToken();

            // Guardar el token en el usuario
            user.resetToken = {
                token: token,
                expiresAt: new Date(Date.now() + 3600000) // 1 hora de duración
            };
            await userRepository.save(user);

            // Enviar correo electrónico con el enlace de restablecimiento utilizando EmailManager
            await emailManager.enviarCorreoRestablecimiento(email, user.first_name, token);

            res.redirect("/confirmacion-envio");
        } catch (error) {
            console.error("Error al solicitar restablecimiento de contraseña:", error);
            res.status(500).send("Error interno del servidor");
        }
    }

    async resetPassword(req, res) {
        const { email, password, token } = req.body;

        try {
            // Buscar al usuario por su correo electrónico
            const user = await userRepository.findByEmail(email);
            if (!user) {
                return res.render("passwordcambio", { error: "Usuario no encontrado" });
            }

            // Obtener el token de restablecimiento de la contraseña del usuario
            const resetToken = user.resetToken;
            if (!resetToken || resetToken.token !== token) {
                return res.render("passwordreset", { error: "El token de restablecimiento de contraseña es inválido" });
            }

            // Verificar si el token ha expirado
            const now = new Date();
            if (now > resetToken.expiresAt) {
                // Redirigir a la página de generación de nuevo correo de restablecimiento
                return res.redirect("/passwordcambio");
            }

            // Verificar si la nueva contraseña es igual a la anterior
            if (isValidPassword(password, user)) {
                return res.render("passwordcambio", { error: "La nueva contraseña no puede ser igual a la anterior" });
            }

            // Actualizar la contraseña del usuario
            user.password = createHash(password);
            user.resetToken = undefined; // Marcar el token como utilizado
            await userRepository.save(user);

            // Renderizar la vista de confirmación de cambio de contraseña
            return res.redirect("/login");
        } catch (error) {
            console.error("Error al restablecer la contraseña:", error);
            return res.status(500).render("passwordreset", { error: "Error interno del servidor" });
        }
    }

    async cambiarRolPremium(req, res) {
        const { uid } = req.params;
        try {
            const user = await userRepository.findById(uid);

            if (!user) {
                return res.status(404).send("Usuario no encontrado");
            }

            // Verificamos si el usuario tiene la propiedad documents
            if (!user.documents || user.documents.length < 3) {
                return res.status(400).send("El usuario no ha subido todos los documentos necesarios");
            }

            user.role = user.role === "premium" ? "user" : "premium";
            await userRepository.save(user);

            res.redirect("/api/users");
        } catch (error) {
            console.error("Error al cambiar rol del usuario:", error);
            res.status(500).send("Error interno del servidor");
        }
    }

    async getAllUsers(req, res) {
        try {
            const users = await userRepository.getAllUsers();
            res.json(users);
        } catch (error) {
            console.error("Error al obtener usuarios:", error);
            res.status(500).send("Error interno del servidor");
        }
    }

    async deleteInactiveUsers(req, res) {
        try {
            const threshold = 30 * 24 * 60 * 60 * 1000; // 30 días en milisegundos
            const inactiveUsers = await userRepository.getInactiveUsers(threshold);

            for (const user of inactiveUsers) {
                await userRepository.deleteUser(user._id);
            }

            res.send(`Usuarios inactivos eliminados: ${inactiveUsers.length}`);
        } catch (error) {
            console.error("Error al eliminar usuarios inactivos:", error);
            res.status(500).send("Error interno del servidor");
        }
    }
}

module.exports = UserController;
