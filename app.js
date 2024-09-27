const express = require("express");
const axios = require("axios");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const session = require("express-session"); // Para manejar sesiones
const translate = require("node-google-translate-skidz");

const app = express();
const port = 3000;

app.use(cors());
app.use(morgan("dev"));
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], // Permitir contenido solo del mismo origen
        imgSrc: ["'self'", "data:", "https://images.metmuseum.org"], // Permitir imágenes de este dominio
        // Otras directivas CSP que necesites
      },
    },
  })
);
app.use(
  session({
    secret: "mySecret", // Cambia esto por un valor más seguro en producción
    resave: false,
    saveUninitialized: true,
  })
);

// Configurar Pug como motor de plantillas
app.set("views", path.join(__dirname, "pages"));
app.set("view engine", "pug");

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const getDepartments = async () => {
  const url_departments =
    "https://collectionapi.metmuseum.org/public/collection/v1/departments";
  const searchResponse = await axios(url_departments);
  return searchResponse.data.departments;
};
const getObjects = async () => {
  const searchUrl = `https://collectionapi.metmuseum.org/public/collection/v1/search?q=&hasImages=true`;
  const searchResponse = await axios.get(searchUrl);
  return searchResponse.data.objectIDs;
};

const getObjectsByFilters = async (departmentId, keyword, geolocation) => {
  if (departmentId == "" && keyword == "" && geolocation == "") {
    const allObjects = await getObjects();
    return allObjects;
  }
  const paramLocation = geolocation != "" ? `&geoLocation=${geolocation}` : "";
  const paramDepartment =
    departmentId != "" ? `&departmentId=${departmentId}` : "";
  try {
    const searchUrl = `https://collectionapi.metmuseum.org/public/collection/v1/search`;
    const searchResponse = await axios.get(
      searchUrl + `?q=${keyword}${paramDepartment}${paramLocation}`
    );
    return searchResponse.data.objectIDs;
  } catch (error) {
    console.error("Error al realizar la búsqueda:", error);
  }
};

const getObjectsByPage = async (objectIDs, page = 1, limit = 20) => {
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;

  // Asegúrate de que solo obtienes IDs dentro del rango de paginación
  const paginatedIDs = objectIDs.slice(startIndex, endIndex);

  // Crea un array de promesas para las solicitudes de los objetos
  const requests = paginatedIDs.map((id) => {
    return axios
      .get(
        `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`
      )
      .then((response) => response.data) // Devuelve solo los datos de la respuesta
      .catch((error) => {
        // Manejo de errores por cada solicitud individual
        if (error.response && error.response.status === 404) {
          console.warn(`Objeto con ID ${id} no encontrado.`);
          return null; // Retorna null para IDs no encontrados
        } else {
          console.error("Error al realizar la búsqueda:", error);
          return null; // Retorna null en caso de otro error
        }
      });
  });

  // Espera a que todas las promesas se resuelvan
  const results = await Promise.all(requests);

  // Filtra los resultados para eliminar cualquier null que haya sido retornado por errores
  return results.filter((result) => result !== null);
};

// const translate = require("node-google-translate-skidz");
// translate({ text: "hello", source: "en", target: "es" }, function (traduccion) {
//   console.log(traduccion, traduccion.translation);
// });

const translateObjects = async (data) => {
  const results = await Promise.all(
    data.map(async (prod) => {
      const armado = {
        id: prod.objectID,
        img: prod.primaryImageSmall,
        title: prod.title || "Sin datos de Titulo",
        culture: prod.culture || "Sin datos de Cultura",
        dynasty: prod.dynasty || "Sin datos de dinastía",
        moreImg: prod.additionalImages || null,
        fecha: prod.objectDate,
      };

      const translatePromises = [];

      if (prod.title) {
        translatePromises.push(
          (async () => {
            try {
              const translateTitle = await translate(prod.title, "en", "es");
              if (translateTitle && translateTitle.translation) {
                armado.title = translateTitle.translation;
              }
            } catch (error) {
              console.error("Error al traducir título:", error.message);
            }
          })()
        );
      }

      if (prod.culture) {
        translatePromises.push(
          (async () => {
            try {
              const translateCulture = await translate(
                prod.culture,
                "en",
                "es"
              );
              if (translateCulture && translateCulture.translation) {
                armado.culture = translateCulture.translation;
              }
            } catch (error) {
              console.error("Error al traducir cultura:", error.message);
            }
          })()
        );
      }

      if (prod.dynasty) {
        translatePromises.push(
          (async () => {
            try {
              const translateDynasty = await translate(
                prod.dynasty,
                "en",
                "es"
              );
              if (translateDynasty && translateDynasty.translation) {
                armado.dynasty = translateDynasty.translation;
              }
            } catch (error) {
              console.error("Error al traducir dinastía:", error.message);
            }
          })()
        );
      }

      await Promise.all(translatePromises);
      return armado;
    })
  );

  return results;
};

// Ruta principal para la página inicial
app.get("/", async (req, res) => {
  const page = parseInt(req.query.page) || 1; // Página actual
  const limit = parseInt(req.query.limit) || 20; // Límite de objetos por página

  try {
    // Usar los IDs almacenados en la sesión para la paginación
    const departments = await getDepartments();
    const objects = req.session.filteredObjectIDs || (await getObjects());
    const objectsresult = await getObjectsByPage(objects, page, limit); // Paginación
    const finalObject = await translateObjects(objectsresult); // Traducción

    res.render("index", { departments, finalObject, page, limit });
  } catch (error) {
    console.log(`Error al procesar la solicitud: ${error}`);
    res.status(500).send("Error al procesar la solicitud.");
  }
});

// Ruta para aplicar los filtros y guardar los IDs en la sesión
app.get("/filtrar", async (req, res) => {
  const { department, keyword, location, page = 1 } = req.query; // 'page' es opcional, por defecto será 1
  const limit = parseInt(req.query.limit) || 20; // Límite de objetos por página

  try {
    // Obtener objetos filtrados
    const departments = await getDepartments();
    const objects = await getObjectsByFilters(department, keyword, location);

    // Guardar los IDs en la sesión
    req.session.filteredObjectIDs = objects;

    // Paginación sobre los IDs filtrados
    const objectsresult = await getObjectsByPage(objects, page, limit);
    const finalObject = await translateObjects(objectsresult); // Traducción

    res.render("index", { departments, finalObject, page, limit });
  } catch (error) {
    console.log(`Error al procesar la solicitud: ${error}`);
    res.status(500).send("Error al procesar la solicitud.");
  }
});
// Ruta para Mostrar mas imagenes
app.get("/moreImg/:id", async (req, res) => {
  let id = [];
  id.push(parseInt(req.params.id)); // Captura el id de la URL

  const page = 1; // Suponiendo que tienes un valor predeterminado para la página
  const limit = 10; // Suponiendo que tienes un valor predeterminado para el límite

  const objectsresult = await getObjectsByPage(id, page, limit);
  const finalObject = await translateObjects(objectsresult); // Traducción

  res.render("moreImg", { finalObject });
});

// Controlador de error
app.use((req, res) => {
  res.status(404).render("error", {
    title: "error 404 Not Found",
    message: "la ruta que estas buscando no existe",
  });
});

app.listen(port, () => {
  console.log(`La aplicación está funcionando en: http://localhost:${port}`);
});
