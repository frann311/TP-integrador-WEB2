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
  let paginatedIDs = [];
  if (objectIDs.length > limit) {
    paginatedIDs = objectIDs.slice(startIndex, endIndex);
  } else {
    paginatedIDs = objectIDs;
  }

  const results = [];
  for (const id of paginatedIDs) {
    try {
      const response = await axios.get(
        `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`
      );
      results.push(response.data);
    } catch (error) {
      if (error.response && error.response.status === 404) {
      } else {
        console.error("Error al realizar la búsqueda:", error);
      }
    }
  }

  return results;
};
// const translateObjects = async (data) => {
//   const results = [];
//   try {
//     await Promise.all(
//       data.map(async (prod) => {
//         const armado = {
//           id: prod.objectID,
//           img: prod.primaryImageSmall,
//           title: "Sin datos de Titulo",
//           culture: "Sin datos de Cultura",
//           dynasty: "Sin datos de dinastia",
//           moreImg: null,
//           fecha: prod.objectDate,
//         };

//         if (prod.title) {
//           const translateTitle = await translate(prod.title, "en", "es");
//           armado.title = translateTitle.translation;
//         }
//         if (prod.culture) {
//           const translateCulture = await translate(prod.culture, "en", "es");
//           armado.culture = translateCulture.translation;
//         }
//         if (prod.dynasty) {
//           const translateDynasty = await translate(prod.dynasty, "en", "es");
//           armado.dynasty = translateDynasty.translation;
//         }
//         if (prod.additionalImages && prod.additionalImages.length > 0)
//           armado.moreImg = prod.additionalImages;

//         results.push(armado);
//       })
//     );
//     return results;
//   } catch (error) {
//     console.log(`Error al traducir: ${error}`);
//     console.log(error.response ? error.response.data : "No response data");
//     return [];
//   }
// };

const translateObjects = async (data) => {
  const results = [];
  try {
    await Promise.all(
      data.map(async (prod) => {
        const armado = {
          id: prod.objectID,
          img: prod.primaryImageSmall,
          title: "Sin datos de Titulo",
          culture: "Sin datos de Cultura",
          dynasty: "Sin datos de dinastia",
          moreImg: null,
          fecha: prod.objectDate,
        };

        if (prod.title) {
          const translateTitle = await translate(prod.title, "en", "es");
          if (translateTitle && translateTitle.translation) {
            armado.title = translateTitle.translation;
          }
        }
        if (prod.culture) {
          const translateCulture = await translate(prod.culture, "en", "es");
          if (translateCulture && translateCulture.translation) {
            armado.culture = translateCulture.translation;
          }
        }
        if (prod.dynasty) {
          const translateDynasty = await translate(prod.dynasty, "en", "es");
          if (translateDynasty && translateDynasty.translation) {
            armado.dynasty = translateDynasty.translation;
          }
        }
        if (prod.additionalImages && prod.additionalImages.length > 0)
          armado.moreImg = prod.additionalImages;

        results.push(armado);
      })
    );
    return results;
  } catch (error) {
    console.log(`Error al traducir: ${error.message}`);
    return [];
  }
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
