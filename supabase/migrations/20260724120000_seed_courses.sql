-- ============================================================================
-- Seed the Île-de-France course database (T1.6)
-- ============================================================================
-- Source: Golfs_Ile_de_France.xlsx (hand-built, 129 courses/installations),
-- merged with its "Cartes de Score (résumé)" sheet for holes / par / per-tee
-- distances. This is the app's only proprietary data asset and until now it
-- was invisible in the product — Create Game asked for a free-text course
-- name with an American placeholder.
--
-- `courses` is public reference data: readable by any authenticated user,
-- writable only by the service role (no client INSERT/UPDATE/DELETE grants).
-- Free text stays allowed on games/matches; a course picked from here simply
-- carries verified par/holes/location.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.courses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  city          text,
  postcode      text,
  department    text,
  dept_no       text,
  course_type   text,
  access        text,
  holes         integer,
  par           integer,
  dist_white    integer,
  dist_yellow   integer,
  dist_red      integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Idempotent seeding key + the index that powers type-ahead search.
CREATE UNIQUE INDEX IF NOT EXISTS courses_name_city_uq
  ON public.courses (lower(name), lower(coalesce(city, '')));
-- pg_trgm lives in `extensions` on hosted Supabase and in `public` on the
-- local CLI stack; resolve the operator class through search_path so this
-- migration replays in both (CI caught the hard-coded schema).
SET search_path = public, extensions;
CREATE INDEX IF NOT EXISTS courses_name_trgm_idx
  ON public.courses USING gin (name gin_trgm_ops);
SET search_path = public;

ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS courses_select_authenticated ON public.courses;
CREATE POLICY courses_select_authenticated ON public.courses
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.courses FROM anon, authenticated;
GRANT SELECT ON public.courses TO authenticated;

INSERT INTO public.courses
  (name, city, postcode, department, dept_no, course_type, access, holes, par, dist_white, dist_yellow, dist_red)
VALUES
  ('Golf ParisLongchamp (Bois de Boulogne)', 'Paris', '75016', 'Paris', '75', 'Practice', 'Public', NULL, NULL, NULL, NULL, NULL),
  ('Golf en Ville', 'Paris', '75', 'Paris', '75', 'Simulators', 'Indoor', NULL, NULL, NULL, NULL, NULL),
  ('Swing City', 'Paris', '75', 'Paris', '75', 'Simulators', 'Indoor', NULL, NULL, NULL, NULL, NULL),
  ('LSC Golf', 'Paris', '75', 'Paris', '75', 'Simulators', 'Indoor', NULL, NULL, NULL, NULL, NULL),
  ('Golfskills', 'Paris', '75', 'Paris', '75', 'Simulators', 'Indoor', NULL, NULL, NULL, NULL, NULL),
  ('Golf de Fontainebleau', 'Fontainebleau', '77300', 'Seine-et-Marne', '77', '18 holes', 'Private', 18, 72, 6008, 5644, 4804),
  ('Crécy Golf - Parcours Montpichet', 'Crécy-la-Chapelle', '77580', 'Seine-et-Marne', '77', '18 holes', 'Public', 9, 70, 2542, 2429, 1997),
  ('Crécy Golf - Parcours Vignoly', 'Crécy-la-Chapelle', '77580', 'Seine-et-Marne', '77', '18 holes', 'Public', 18, 74, 6112, 5702, 4745),
  ('Exclusiv Golf du Château de Cély', 'Cély-en-Bière', '77930', 'Seine-et-Marne', '77', '18 holes', 'Public', 18, 72, 5856, 5431, 4709),
  ('Golf de La Croix des Anges', 'Réau', '77550', 'Seine-et-Marne', '77', '9 holes', 'Public', 9, 62, 2017, 2017, 1786),
  ('Golf Clément Ader', 'Gretz-Armainvilliers', '77220', 'Seine-et-Marne', '77', '18 holes', 'Public', 18, 72, 6059, 5749, 4868),
  ('Golf de Bussy-Guermantes - La Brèche', 'Bussy-Saint-Georges', '77600', 'Seine-et-Marne', '77', '18 holes', 'Public', 18, NULL, NULL, NULL, NULL),
  ('Golf de Bussy-Guermantes - La Gondoire', 'Bussy-Saint-Georges', '77600', 'Seine-et-Marne', '77', '9 holes', 'Public', 9, 70, 2715, 2593, 2298),
  ('Golf de Montereau la Forteresse', 'Thoury-Férottes', '77940', 'Seine-et-Marne', '77', '18 holes', 'Public', 18, NULL, NULL, NULL, NULL),
  ('Golf de la Marsaudière', 'Chevry-Cossigny', '77173', 'Seine-et-Marne', '77', '9 holes', 'Public', 9, 70, 2663, 2481, 2137),
  ('Golf de Réveillon - Parcours 18T', 'Lésigny', '77150', 'Seine-et-Marne', '77', '18 holes', 'Public', 18, NULL, NULL, NULL, NULL),
  ('Golf de Réveillon - Parcours 9T (1)', 'Lésigny', '77150', 'Seine-et-Marne', '77', '9 holes', 'Public', 9, NULL, NULL, NULL, NULL),
  ('Golf de Réveillon - Parcours 9T (2)', 'Lésigny', '77150', 'Seine-et-Marne', '77', '9 holes', 'Public', 9, NULL, NULL, NULL, NULL),
  ('Golf de Torcy', 'Torcy', '77200', 'Seine-et-Marne', '77', '9 holes', 'Public', 9, NULL, NULL, NULL, NULL),
  ('Golf de Bois-le-Roi', 'Bois-le-Roi', '77590', 'Seine-et-Marne', '77', '9 holes', 'Public', 9, 68, 2313, 2313, 2069),
  ('Golf de Fontenailles', 'Fontenailles', '77370', 'Seine-et-Marne', '77', '3 x 9 holes', 'Closed', NULL, NULL, NULL, NULL, NULL),
  ('Golf de Meaux-Boutigny', 'Boutigny', '77470', 'Seine-et-Marne', '77', '18 holes', 'Public', 18, 72, 5767, 5547, 4580),
  ('Golf d''Ozoir-la-Ferrière', 'Ozoir-la-Ferrière', '77330', 'Seine-et-Marne', '77', '18 holes + 9 holes', 'Public', 18, 72, 5980, 5632, 4716),
  ('Golf du Château L''Hermitage', 'Crécy-la-Chapelle', '77580', 'Seine-et-Marne', '77', '9 holes compact', 'Public', 9, NULL, NULL, NULL, NULL),
  ('Golf Paris Val d''Europe (Disneyland)', 'Magny-le-Hongre', '77700', 'Seine-et-Marne', '77', '3 x 9 holes', 'Public', NULL, NULL, NULL, NULL, NULL),
  ('Golf du Lac de Germigny', 'Germigny-l''Évêque', '77910', 'Seine-et-Marne', '77', '9 holes', 'Closed', 9, NULL, NULL, NULL, NULL),
  ('Golf National - L''Albatros', 'Guyancourt', '78280', 'Yvelines', '78', '18 holes', 'Public', 18, 72, 6155, 5753, 5051),
  ('Golf National - L''Aigle', 'Guyancourt', '78280', 'Yvelines', '78', '18 holes', 'Public', 18, 71, 5815, 5543, 4758),
  ('Golf National - L''Oiselet', 'Guyancourt', '78280', 'Yvelines', '78', '9 holes', 'Public', 9, 62, NULL, 1998, 1818),
  ('Golf de la Boulie - La Vallée', 'Versailles', '78000', 'Yvelines', '78', '18 holes', 'Private', 18, NULL, NULL, NULL, NULL),
  ('Golf de la Boulie - La Forêt', 'Versailles', '78000', 'Yvelines', '78', '18 holes', 'Private', 18, NULL, NULL, NULL, NULL),
  ('Golf de la Boulie - 9 trous', 'Versailles', '78000', 'Yvelines', '78', '9 holes', 'Private', 9, NULL, NULL, NULL, NULL),
  ('Golf de Saint-Nom-la-Bretêche - Bleu', 'Saint-Nom-la-Bretêche', '78860', 'Yvelines', '78', '18 holes', 'Private', 18, 72, 6020, 5654, 4895),
  ('Golf de Saint-Nom-la-Bretêche - Rouge', 'Saint-Nom-la-Bretêche', '78860', 'Yvelines', '78', '18 holes', 'Private', 18, 72, 6055, 5656, 4772),
  ('Golf Isabella', 'Plaisir', '78370', 'Yvelines', '78', '18 holes', 'Public', 18, 71, 5616, 5245, 4598),
  ('Béthemont Golf & Country Club', 'Poissy', '78300', 'Yvelines', '78', '18 holes', 'Public', 18, 72, 5926, 5544, 4764),
  ('Golf Country Club de Fourqueux - Blanc/Bleu', 'Fourqueux', '78112', 'Yvelines', '78', '18 holes', 'Private', 18, NULL, NULL, NULL, NULL),
  ('Golf Country Club de Fourqueux - Rouge', 'Fourqueux', '78112', 'Yvelines', '78', '9 holes', 'Private', 9, 72, 5720, 5409, 4756),
  ('Exclusiv Golf de Feucherolles', 'Feucherolles', '78810', 'Yvelines', '78', '18 holes', 'Public', 18, 72, 6348, 5877, 4960),
  ('Golf de Saint-Marc', 'Jouy-en-Josas', '78350', 'Yvelines', '78', '18 holes', 'Public', 18, 71, 5756, 5459, 4667),
  ('Golf Blue Green de Villennes', 'Villennes-sur-Seine', '78670', 'Yvelines', '78', '18 holes', 'Public', 18, NULL, NULL, NULL, NULL),
  ('Golf de Saint-Quentin-en-Yvelines - Bleu', 'Trappes', '78190', 'Yvelines', '78', '18 holes', 'Public', 18, NULL, NULL, NULL, NULL),
  ('Golf de Saint-Quentin-en-Yvelines - Rouge', 'Trappes', '78190', 'Yvelines', '78', '18 holes', 'Public', 18, NULL, NULL, NULL, NULL),
  ('La Vaucouleurs - La Rivière', 'Civry-la-Forêt', '78910', 'Yvelines', '78', '18 holes', 'Public', 18, 73, 6172, 5608, 4859),
  ('La Vaucouleurs - Les Vallons', 'Civry-la-Forêt', '78910', 'Yvelines', '78', '18 holes', 'Public', 18, 70, 5612, 5104, 4255),
  ('La Vaucouleurs - Le 360', 'Civry-la-Forêt', '78910', 'Yvelines', '78', '9 holes', 'Public', 9, NULL, NULL, NULL, NULL),
  ('Exclusiv Golf de Rochefort', 'Rochefort-en-Yvelines', '78730', 'Yvelines', '78', '18 holes', 'Public', 18, NULL, NULL, NULL, NULL),
  ('Golf Blue Green de Guerville', 'Guerville', '78930', 'Yvelines', '78', '9 holes', 'Public', 9, NULL, NULL, NULL, NULL),
  ('Golf de Saint-Germain - Le Grand Parcours', 'Saint-Germain-en-Laye', '78100', 'Yvelines', '78', '18 holes', 'Private', 18, 72, 6131, 5793, 5223),
  ('Golf de Saint-Germain - Les Genêts', 'Saint-Germain-en-Laye', '78100', 'Yvelines', '78', '9 holes', 'Private', 9, 66, 1951, 1951, 1851),
  ('Golf de Joyenval - Marly', 'Chambourcy', '78240', 'Yvelines', '78', '18 holes', 'Private', 18, 72, 6092, 5601, 4555),
  ('Golf de Joyenval - Retz', 'Chambourcy', '78240', 'Yvelines', '78', '18 holes', 'Private', 18, 72, 6064, 5586, 4577),
  ('Golf du Château de la Chouette', 'Gaillon-sur-Montcient', '78250', 'Yvelines', '78', '18 holes', 'Public', 18, 72, 6116, 5671, 4867),
  ('Golf de Maisons-Laffitte', 'Maisons-Laffitte', '78600', 'Yvelines', '78', '9 holes', 'Public', 9, 60, 1656, 1556, 1382),
  ('Golf de Villacoublay (Région Aérienne)', 'Vélizy-Villacoublay', '78140', 'Yvelines', '78', '18 holes', 'Public', 18, NULL, NULL, NULL, NULL),
  ('Golf des Boucles de Seine', 'Moisson', '78840', 'Yvelines', '78', '18 holes', 'Public', 18, 70, 5478, 5124, 4247),
  ('Golf du Prieuré - Ouest', 'Sailly', '78440', 'Yvelines', '78', '18 holes', 'Private', 18, 72, 6148, 5681, 4894),
  ('Golf du Prieuré - Est', 'Sailly', '78440', 'Yvelines', '78', '18 holes', 'Private', 18, 72, 5937, 5567, 4741),
  ('Golf du Tremblay-sur-Mauldre - Château', 'Le Tremblay-sur-Mauldre', '78490', 'Yvelines', '78', '9 holes', 'Public', 9, NULL, NULL, NULL, NULL),
  ('Golf du Tremblay-sur-Mauldre - Le Parc', 'Le Tremblay-sur-Mauldre', '78490', 'Yvelines', '78', '9 holes P&P', 'Public', 9, NULL, NULL, NULL, NULL),
  ('Île Fleurie Golf Club', 'Chatou', '78400', 'Yvelines', '78', '9 holes', 'Public', 9, 55, 1445, 1343, 990),
  ('Golf de Beynes', 'Beynes', '78650', 'Yvelines', '78', '4 holes P&P', 'Public', 4, NULL, NULL, NULL, NULL),
  ('Golf de Buc-Toussus (Dailybuc)', 'Buc', '78530', 'Yvelines', '78', '9 holes compact', 'Public', 9, 56, NULL, 1165, 1015),
  ('Golf de Noisy-le-Roi', 'Noisy-le-Roi', '78590', 'Yvelines', '78', '9 holes compact', 'Public', 9, NULL, NULL, NULL, NULL),
  ('Golf des Yvelines', 'La Queue-lez-Yvelines', '78940', 'Yvelines', '78', '18 holes + 9 holes', 'Public', 18, 72, 6121, 5741, 4983),
  ('Golf des Loges', 'Saint-Germain-en-Laye', '78100', 'Yvelines', '78', '9 holes compact', 'Public', 9, NULL, NULL, NULL, NULL),
  ('Golf de Saint-Aubin - Le Mesnil', 'Saint-Aubin', '91190', 'Essonne', '91', '18 holes', 'Public', 18, 70, 5494, 5244, 4787),
  ('Golf de Saint-Aubin - Les Saules', 'Saint-Aubin', '91190', 'Essonne', '91', '9 holes', 'Public', 9, NULL, NULL, NULL, NULL),
  ('Golf de Saint-Aubin - Pitch & Putt', 'Saint-Aubin', '91190', 'Essonne', '91', '6 holes P&P', 'Public', 6, NULL, NULL, NULL, NULL),
  ('Blue Green Golf de Villeray', 'Saint-Pierre-du-Perray', '91280', 'Essonne', '91', '18 holes', 'Public', 18, NULL, NULL, NULL, NULL),
  ('Golf de Sénart - Les Cygnes', 'Saint-Pierre-du-Perray', '91280', 'Essonne', '91', '18 holes', 'Public', 18, 71, 5807, 5244, 4175),
  ('Golf de Sénart - L''Arbalète', 'Saint-Pierre-du-Perray', '91280', 'Essonne', '91', '9 holes', 'Public', 9, NULL, NULL, NULL, NULL),
  ('Golf de Saint-Germain-lès-Corbeil', 'Saint-Germain-lès-Corbeil', '91250', 'Essonne', '91', '18 holes', 'Public', 18, NULL, NULL, NULL, NULL),
  ('Golf de Marivaux', 'Janvry', '91640', 'Essonne', '91', '18 holes', 'Public', 18, 72, 6026, 5545, 4646),
  ('Golf de Val Grand', 'Bondoufle', '91070', 'Essonne', '91', '18 holes', 'Public', 18, 71, 5893, 5298, 4421),
  ('Golf d''Etiolles - Les Cerfs', 'Etiolles', '91450', 'Essonne', '91', '18 holes', 'Public', 18, 73, 6176, 5705, 5067),
  ('Golf d''Etiolles - Les Chênes', 'Etiolles', '91450', 'Essonne', '91', '9 holes', 'Public', 9, 70, 2665, 2400, 2071),
  ('Exclusiv Golf de Coudray - Les Marronniers', 'Le Coudray-Montceaux', '91830', 'Essonne', '91', '18 holes', 'Public', 18, NULL, NULL, NULL, NULL),
  ('Exclusiv Golf de Coudray - La Guiche', 'Le Coudray-Montceaux', '91830', 'Essonne', '91', '9 holes', 'Public', 9, NULL, NULL, NULL, NULL),
  ('Golf de Courson Stade Français - Vert/Noir', 'Courson-Monteloup', '91680', 'Essonne', '91', '18 holes', 'Public', 18, 72, 6109, 5738, 4722),
  ('Golf de Courson Stade Français - Lilas/Orange', 'Courson-Monteloup', '91680', 'Essonne', '91', '18 holes', 'Public', 18, 72, 5841, 5494, 4453),
  ('Golf de Forges-les-Bains', 'Forges-les-Bains', '91470', 'Essonne', '91', '18 holes', 'Public', 18, 72, 6144, 5803, 4938),
  ('Golf de Gif-Chevry', 'Gif-sur-Yvette', '91190', 'Essonne', '91', '9 holes', 'Public', 18, 67, 2518, 2463, 2126),
  ('Golf de Mennecy Chevannes - 18T', 'Chevannes', '91750', 'Essonne', '91', '18 holes', 'Public', 9, 54, 1006, 1006, 1006),
  ('Golf de Mennecy Chevannes - 9T', 'Chevannes', '91750', 'Essonne', '91', '9 holes compact', 'Public', 9, 54, 1006, 1006, 1006),
  ('Golf de l''Yvette', 'Bures-sur-Yvette', '91440', 'Essonne', '91', '9 holes', 'Public', 9, NULL, NULL, NULL, NULL),
  ('Golf des Bruyères', 'Saint-Aubin', '91190', 'Essonne', '91', '9 holes', 'Public', 9, NULL, NULL, NULL, NULL),
  ('Golf Country Club des Pyramides', 'Saint-Pierre-du-Perray', '91280', 'Essonne', '91', '5 holes compact', 'Public', 5, NULL, NULL, NULL, NULL),
  ('Golf de Morangis La Galande', 'Morangis', '91420', 'Essonne', '91', '9 holes + 9 P&P', 'Public', 9, 54, 974, 810, 721),
  ('Golf de Verrières-le-Buisson', 'Verrières-le-Buisson', '91370', 'Essonne', '91', '9 holes compact', 'Public', 9, 56, 1253, 1140, 971),
  ('Golf de Belesbat', 'Boutigny-sur-Essonne', '91820', 'Essonne', '91', '18 holes', 'Closed', 18, NULL, NULL, NULL, NULL),
  ('Club Olympique Savigny Tennis - Golf', 'Savigny-sur-Orge', '91600', 'Essonne', '91', 'Association', 'Public', NULL, NULL, NULL, NULL, NULL),
  ('Golf club de Draveil', 'Draveil', '91210', 'Essonne', '91', 'Association', 'Public', NULL, NULL, NULL, NULL, NULL),
  ('Golf de Saint-Cloud - Parcours Vert', 'Garches', '92380', 'Hauts-de-Seine', '92', '18 holes', 'Private', 18, 71, 5967, 5624, 4976),
  ('Golf de Saint-Cloud - Parcours Jaune', 'Garches', '92380', 'Hauts-de-Seine', '92', '18 holes', 'Private', 18, 68, 4854, 4678, 4166),
  ('Paris Golf & Country Club - 9T', 'Saint-Cloud', '92210', 'Hauts-de-Seine', '92', '9 holes', 'Public', 9, NULL, NULL, NULL, NULL),
  ('Paris Golf & Country Club - Pitch & Putt', 'Saint-Cloud', '92210', 'Hauts-de-Seine', '92', '9 holes P&P', 'Public', 9, NULL, NULL, NULL, NULL),
  ('Golf du Haras de Jardy', 'Vaucresson', '92420', 'Hauts-de-Seine', '92', '9 holes', 'Public', 9, 60, 1490, 1388, 1247),
  ('Golf du Stade Français Haras Lupin', 'Vaucresson', '92420', 'Hauts-de-Seine', '92', '9 holes', 'Public', 9, NULL, NULL, NULL, NULL),
  ('Golf de Rueil-Malmaison', 'Rueil-Malmaison', '92500', 'Hauts-de-Seine', '92', '9 holes', 'Public', 9, 64, 1926, 1782, 1469),
  ('Neuilly Golf', 'Neuilly-sur-Seine', '92200', 'Hauts-de-Seine', '92', 'Association', 'Public', NULL, NULL, NULL, NULL, NULL),
  ('Golf de Rosny-sous-Bois', 'Rosny-sous-Bois', '93110', 'Seine-Saint-Denis', '93', '9 holes', 'Public', 9, 66, 1907, 1907, 1724),
  ('Golf départemental de la Poudrerie', 'Sevran', '93270', 'Seine-Saint-Denis', '93', '9 holes compact', 'Public', 9, NULL, NULL, NULL, NULL),
  ('Golf Blue Green Marolles', 'Marolles-en-Brie', '94440', 'Val-de-Marne', '94', '18 holes', 'Public', 18, NULL, NULL, NULL, NULL),
  ('Golf d''Ormesson', 'Ormesson-sur-Marne', '94490', 'Val-de-Marne', '94', '18 holes', 'Public', 18, 71, 6004, 5709, 4968),
  ('Golf club de Thiais', 'Thiais', '94320', 'Val-de-Marne', '94', 'Association', 'Public', NULL, NULL, NULL, NULL, NULL),
  ('Golf du Parc du Tremblay', 'Champigny-sur-Marne', '94500', 'Val-de-Marne', '94', '9 holes compact + 6 P&P', 'Public', 9, 54, 928, 928, 590),
  ('Golf de la Grenouillère', 'La Varenne-Saint-Hilaire', '94210', 'Val-de-Marne', '94', '9 holes', 'Public', 9, NULL, NULL, NULL, NULL),
  ('Golf Blue Green Bellefontaine - Le Plessis 18', 'Bellefontaine', '95270', 'Val-d''Oise', '95', '18 holes', 'Public', 9, 72, 2863, 2653, 2296),
  ('Golf Blue Green Bellefontaine - Le Plessis 9', 'Bellefontaine', '95270', 'Val-d''Oise', '95', '9 holes', 'Public', 9, 72, 2863, 2653, 2296),
  ('Garden Golf Gadancourt', 'Gadancourt', '95450', 'Val-d''Oise', '95', '18 holes', 'Public', 18, 72, 6266, 6051, 4754),
  ('Golf Club d''Ableiges - Les Étangs', 'Ableiges', '95450', 'Val-d''Oise', '95', '18 holes', 'Public', 18, 72, 6138, 5664, 4758),
  ('Golf Club d''Ableiges - Le Vexin', 'Ableiges', '95450', 'Val-d''Oise', '95', '9 holes', 'Public', 9, 66, 2107, 2107, 1796),
  ('Golf de Montmorency - Les Châtaigniers', 'Domont', '95330', 'Val-d''Oise', '95', '18 holes', 'Public', 18, 71, 5774, 5481, 4857),
  ('Golf de l''Isle-Adam', 'L''Isle-Adam', '95290', 'Val-d''Oise', '95', '18 holes', 'Public', 18, 72, 6188, 5696, 4612),
  ('Golf de Maudétour-en-Vexin', 'Maudétour-en-Vexin', '95420', 'Val-d''Oise', '95', '18 holes', 'Public', 18, NULL, NULL, NULL, NULL),
  ('Golf de Seraincourt', 'Seraincourt', '95450', 'Val-d''Oise', '95', '18 holes', 'Public', 18, 70, 5684, 5287, 4699),
  ('Golf de Villarceaux - Grand Parcours', 'Chaussy', '95710', 'Val-d''Oise', '95', '18 holes', 'Public', 18, NULL, NULL, NULL, NULL),
  ('Golf de Villarceaux - Pitch & Putt', 'Chaussy', '95710', 'Val-d''Oise', '95', '9 holes P&P', 'Public', 9, NULL, NULL, NULL, NULL),
  ('Golf Hôtel de Mont Griffon - Les Lacs', 'Luzarches', '95270', 'Val-d''Oise', '95', '18 holes', 'Public', 18, 72, 5907, 5643, 4864),
  ('Golf Hôtel de Mont Griffon - La Forêt', 'Luzarches', '95270', 'Val-d''Oise', '95', '9 holes', 'Public', 9, 70, 2807, 2568, 2182),
  ('Golf Hôtel de Mont Griffon - L''Arbalétrier', 'Luzarches', '95270', 'Val-d''Oise', '95', '9 holes', 'Public', 9, 54, 886, 886, 677),
  ('Garden Golf Cergy-Pontoise', 'Vauréal', '95490', 'Val-d''Oise', '95', '18 holes', 'Public', 18, NULL, NULL, NULL, NULL),
  ('Golf International de Roissy', 'Roissy-en-France', '95700', 'Val-d''Oise', '95', '18 holes + 6 P&P', 'Public', 18, 72, 5933, 5404, 4335),
  ('Golf d''Ecancourt', 'Jouy-le-Moutier', '95280', 'Val-d''Oise', '95', '6 holes compact', 'Public', 6, NULL, NULL, NULL, NULL),
  ('Golf de Saint-Ouen-l''Aumône', 'Saint-Ouen-l''Aumône', '95310', 'Val-d''Oise', '95', '9 holes', 'Public', 9, 54, 675, 675, 675),
  ('Golf de Gonesse', 'Gonesse', '95500', 'Val-d''Oise', '95', '9 holes', 'Public', 9, 72, 2945, 2705, 2462),
  ('Paris International Golf Club', 'Baillet-en-France', '95560', 'Val-d''Oise', '95', '18 holes', 'Private', 18, 72, 5985, 5581, 4780),
  ('Golf du Liberty Country Club', 'Magny-en-Vexin', '95420', 'Val-d''Oise', '95', '18 holes', 'Public', 18, NULL, NULL, NULL, NULL)
ON CONFLICT (lower(name), lower(coalesce(city, ''))) DO UPDATE SET
  postcode    = EXCLUDED.postcode,
  department  = EXCLUDED.department,
  dept_no     = EXCLUDED.dept_no,
  course_type = EXCLUDED.course_type,
  access      = EXCLUDED.access,
  holes       = COALESCE(EXCLUDED.holes, public.courses.holes),
  par         = COALESCE(EXCLUDED.par, public.courses.par),
  dist_white  = COALESCE(EXCLUDED.dist_white, public.courses.dist_white),
  dist_yellow = COALESCE(EXCLUDED.dist_yellow, public.courses.dist_yellow),
  dist_red    = COALESCE(EXCLUDED.dist_red, public.courses.dist_red);

-- ----------------------------------------------------------------------------
-- Type-ahead RPC: trigram + prefix search, playable courses ranked first.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.search_courses(p_query text, p_limit integer DEFAULT 8)
RETURNS TABLE (
  id uuid, name text, city text, department text, dept_no text,
  holes integer, par integer, course_type text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
  SELECT c.id, c.name, c.city, c.department, c.dept_no, c.holes, c.par, c.course_type
  FROM public.courses c
  WHERE p_query IS NOT NULL
    AND length(btrim(p_query)) >= 2
    AND (c.name ILIKE '%' || btrim(p_query) || '%'
         OR c.city ILIKE '%' || btrim(p_query) || '%')
  ORDER BY
    -- exact prefix first, then holes-bearing courses, then similarity
    (c.name ILIKE btrim(p_query) || '%') DESC,
    (c.holes IS NOT NULL) DESC,
    similarity(c.name, btrim(p_query)) DESC,
    c.name ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 25);
$fn$;

GRANT EXECUTE ON FUNCTION public.search_courses(text, integer) TO authenticated;

-- ============================================================================
-- VERIFICATION
--   SELECT count(*) FROM courses;                    -- expect 129
--   SELECT count(*) FROM courses WHERE par IS NOT NULL;
--   SELECT name, city, holes, par FROM search_courses('saint', 5);
-- ============================================================================
