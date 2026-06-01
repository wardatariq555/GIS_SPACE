using Microsoft.AspNetCore.Mvc;
using Npgsql;

namespace backend_dotnet.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class PoisController : ControllerBase
    {
        private const string FallbackConnectionString =
            "Host=localhost;Port=5432;Database=lahore_15min_city;Username=postgres;Password=postgres";

        private readonly string _connectionString;

        public PoisController(IConfiguration configuration)
        {
            _connectionString =
                configuration.GetConnectionString("DefaultConnection")
                ?? FallbackConnectionString;
        }

        [HttpGet]
        public IActionResult GetPois()
        {
            using var conn = new NpgsqlConnection(_connectionString);

            conn.Open();

            string sql = @"
                SELECT json_build_object(
                    'type', 'FeatureCollection',
                    'features', json_agg(
                        json_build_object(
                            'type', 'Feature',
                            'geometry', ST_AsGeoJSON(geometry)::json,
                            'properties', json_build_object(
                                'name', COALESCE(name, 'Unknown'),
                                'amenity', amenity,
                                'leisure', leisure,
                                'shop', shop
                            )
                        )
                    )
                )
                FROM lahore_pois;
            ";

            using var cmd = new NpgsqlCommand(sql, conn);

            var result = cmd.ExecuteScalar();

            return Content(
                result?.ToString() ?? "{}",
                "application/json"
            );
        }
    }
}
