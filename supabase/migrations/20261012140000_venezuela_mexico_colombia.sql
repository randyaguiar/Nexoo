-- Venezuela, México y Colombia; Cuba en pausa.
--
-- Cuba no se borra: tiene negocios, productos y pedidos colgando, y las claves
-- foráneas lo impedirían de todos modos —con razón—. Se apaga, que es lo que
-- significa "quitarlo del sitio": desaparece del catálogo junto con sus
-- provincias y sus negocios, y los pedidos que ya existen siguen intactos.
-- Volver a encenderlo es una casilla en el panel.
--
-- Los estados y departamentos de los tres países nuevos vienen cargados: un país
-- sin provincias no sirve para nada, porque no se puede dar de alta un negocio
-- en él. Los municipios no: son miles, y el modelo ya era darlos de alta desde
-- el panel según aparecen negocios, como se hizo con Cuba.

update public.countries set active = false where code = 'CU';

insert into public.countries (code, name, phone_prefix, active) values
    ('VE', 'Venezuela', '+58', true),
    ('MX', 'México',    '+52', true),
    ('CO', 'Colombia',  '+57', true)
on conflict (code) do update
set name         = excluded.name,
    phone_prefix = excluded.phone_prefix,
    active       = excluded.active;

-- El código lleva el país por delante porque es único en todo el marketplace:
-- 'Sucre' existe en Colombia y en Venezuela, 'Córdoba' en Colombia y en México.
insert into public.provinces (code, country_code, name) values
    ('MXAguascalientes', 'MX', 'Aguascalientes'),
    ('MXBajaCalifornia', 'MX', 'Baja California'),
    ('MXBajaCaliforniaSur', 'MX', 'Baja California Sur'),
    ('MXCampeche', 'MX', 'Campeche'),
    ('MXChiapas', 'MX', 'Chiapas'),
    ('MXChihuahua', 'MX', 'Chihuahua'),
    ('MXCiudadDeMexico', 'MX', 'Ciudad de México'),
    ('MXCoahuila', 'MX', 'Coahuila'),
    ('MXColima', 'MX', 'Colima'),
    ('MXDurango', 'MX', 'Durango'),
    ('MXEstadoDeMexico', 'MX', 'Estado de México'),
    ('MXGuanajuato', 'MX', 'Guanajuato'),
    ('MXGuerrero', 'MX', 'Guerrero'),
    ('MXHidalgo', 'MX', 'Hidalgo'),
    ('MXJalisco', 'MX', 'Jalisco'),
    ('MXMichoacan', 'MX', 'Michoacán'),
    ('MXMorelos', 'MX', 'Morelos'),
    ('MXNayarit', 'MX', 'Nayarit'),
    ('MXNuevoLeon', 'MX', 'Nuevo León'),
    ('MXOaxaca', 'MX', 'Oaxaca'),
    ('MXPuebla', 'MX', 'Puebla'),
    ('MXQueretaro', 'MX', 'Querétaro'),
    ('MXQuintanaRoo', 'MX', 'Quintana Roo'),
    ('MXSanLuisPotosi', 'MX', 'San Luis Potosí'),
    ('MXSinaloa', 'MX', 'Sinaloa'),
    ('MXSonora', 'MX', 'Sonora'),
    ('MXTabasco', 'MX', 'Tabasco'),
    ('MXTamaulipas', 'MX', 'Tamaulipas'),
    ('MXTlaxcala', 'MX', 'Tlaxcala'),
    ('MXVeracruz', 'MX', 'Veracruz'),
    ('MXYucatan', 'MX', 'Yucatán'),
    ('MXZacatecas', 'MX', 'Zacatecas'),
    ('COAmazonas', 'CO', 'Amazonas'),
    ('COAntioquia', 'CO', 'Antioquia'),
    ('COArauca', 'CO', 'Arauca'),
    ('COAtlantico', 'CO', 'Atlántico'),
    ('COBogotaDC', 'CO', 'Bogotá D.C.'),
    ('COBolivar', 'CO', 'Bolívar'),
    ('COBoyaca', 'CO', 'Boyacá'),
    ('COCaldas', 'CO', 'Caldas'),
    ('COCaqueta', 'CO', 'Caquetá'),
    ('COCasanare', 'CO', 'Casanare'),
    ('COCauca', 'CO', 'Cauca'),
    ('COCesar', 'CO', 'Cesar'),
    ('COChoco', 'CO', 'Chocó'),
    ('COCordoba', 'CO', 'Córdoba'),
    ('COCundinamarca', 'CO', 'Cundinamarca'),
    ('COGuainia', 'CO', 'Guainía'),
    ('COGuaviare', 'CO', 'Guaviare'),
    ('COHuila', 'CO', 'Huila'),
    ('COLaGuajira', 'CO', 'La Guajira'),
    ('COMagdalena', 'CO', 'Magdalena'),
    ('COMeta', 'CO', 'Meta'),
    ('CONarino', 'CO', 'Nariño'),
    ('CONorteDeSantander', 'CO', 'Norte de Santander'),
    ('COPutumayo', 'CO', 'Putumayo'),
    ('COQuindio', 'CO', 'Quindío'),
    ('CORisaralda', 'CO', 'Risaralda'),
    ('COSanAndresYProvidencia', 'CO', 'San Andrés y Providencia'),
    ('COSantander', 'CO', 'Santander'),
    ('COSucre', 'CO', 'Sucre'),
    ('COTolima', 'CO', 'Tolima'),
    ('COValleDelCauca', 'CO', 'Valle del Cauca'),
    ('COVaupes', 'CO', 'Vaupés'),
    ('COVichada', 'CO', 'Vichada'),
    ('VEAmazonas', 'VE', 'Amazonas'),
    ('VEAnzoategui', 'VE', 'Anzoátegui'),
    ('VEApure', 'VE', 'Apure'),
    ('VEAragua', 'VE', 'Aragua'),
    ('VEBarinas', 'VE', 'Barinas'),
    ('VEBolivar', 'VE', 'Bolívar'),
    ('VECarabobo', 'VE', 'Carabobo'),
    ('VECojedes', 'VE', 'Cojedes'),
    ('VEDeltaAmacuro', 'VE', 'Delta Amacuro'),
    ('VEDistritoCapital', 'VE', 'Distrito Capital'),
    ('VEFalcon', 'VE', 'Falcón'),
    ('VEGuarico', 'VE', 'Guárico'),
    ('VELaGuaira', 'VE', 'La Guaira'),
    ('VELara', 'VE', 'Lara'),
    ('VEMerida', 'VE', 'Mérida'),
    ('VEMiranda', 'VE', 'Miranda'),
    ('VEMonagas', 'VE', 'Monagas'),
    ('VENuevaEsparta', 'VE', 'Nueva Esparta'),
    ('VEPortuguesa', 'VE', 'Portuguesa'),
    ('VESucre', 'VE', 'Sucre'),
    ('VETachira', 'VE', 'Táchira'),
    ('VETrujillo', 'VE', 'Trujillo'),
    ('VEYaracuy', 'VE', 'Yaracuy'),
    ('VEZulia', 'VE', 'Zulia')
on conflict (code) do nothing;
