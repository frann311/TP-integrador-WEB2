const express = require("express");
const axios = require("axios");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const session = require("express-session");
const translate = require("node-google-translate-skidz");

const app = express();
const port = 3000;

app.use(cors());
app.use(morgan("dev"));
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https://images.metmuseum.org"],
      },
    },
  })
);
app.use(
  session({
    secret: "mySecret",
    resave: false,
    saveUninitialized: true,
  })
);

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
  const paginatedIDs = objectIDs.slice(startIndex, endIndex);
  const requests = paginatedIDs.map((id) => {
    return axios
      .get(
        `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`
      )
      .then((response) => response.data)
      .catch((error) => {
        if (error.response && error.response.status === 404) {
          console.warn(`Objeto con ID ${id} no encontrado.`);
          return null;
        } else {
          console.error("Error al realizar la búsqueda:", error);
          return null;
        }
      });
  });
  const results = await Promise.all(requests);
  return results.filter((result) => result !== null);
};

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

app.get("/", async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;

  try {
    const departments = await getDepartments();
    const objects = req.session.filteredObjectIDs || (await getObjects());
    const objectsresult = await getObjectsByPage(objects, page, limit);
    const finalObject = await translateObjects(objectsresult);

    res.render("index", { departments, finalObject, page, limit });
  } catch (error) {
    console.log(`Error al procesar la solicitud: ${error}`);
    res.status(500).send("Error al procesar la solicitud.");
  }
});

app.get("/filtrar", async (req, res) => {
  const { department, keyword, location, page = 1 } = req.query;
  const limit = parseInt(req.query.limit) || 20;

  try {
    const departments = await getDepartments();
    const objects = await getObjectsByFilters(department, keyword, location);
    req.session.filteredObjectIDs = objects;
    const objectsresult = await getObjectsByPage(objects, page, limit);
    const finalObject = await translateObjects(objectsresult);

    res.render("index", { departments, finalObject, page, limit });
  } catch (error) {
    console.log(`Error al procesar la solicitud: ${error}`);
    res.status(500).send("Error al procesar la solicitud.");
  }
});

app.get("/moreImg/:id", async (req, res) => {
  let id = [];
  id.push(parseInt(req.params.id));
  const page = 1;
  const limit = 10;
  const objectsresult = await getObjectsByPage(id, page, limit);
  const finalObject = await translateObjects(objectsresult);

  res.render("moreImg", { finalObject });
});

app.use((req, res) => {
  res.status(404).render("error", {
    title: "error 404 Not Found",
    message: "la ruta que estas buscando no existe",
  });
});

app.listen(port, () => {
  console.log(`La aplicación está funcionando en: http://localhost:${port}`);
});
