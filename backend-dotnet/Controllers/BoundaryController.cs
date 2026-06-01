using Microsoft.AspNetCore.Mvc;
using Npgsql;

namespace backend_dotnet.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class BoundaryController : ControllerBase
    {
        private const string FallbackConnectionString =
            "Host=localhost;Port=5432;Database=lahore_15min_city;Username=postgres;Password=postgres";

        private readonly string _connectionString;

        public BoundaryController(IConfiguration configuration)
        {
            _connectionString =
                configuration.GetConnectionString("DefaultConnection")
                ?? FallbackConnectionString;
        }

        [HttpGet]
        public IActionResult GetBoundary()
        {
            var geojson = "";

            using var conn = new NpgsqlConnection(_connectionString);

            conn.Open();

            string sql = @"
                SELECT json_build_object(
                    'type', 'Feature',
                    'geometry', ST_AsGeoJSON(geometry)::json,
                    'properties', json_build_object(
                        'name', 'Lahore'
                    )
                )
                FROM lahore_boundary
                LIMIT 1;
            ";

            using var cmd = new NpgsqlCommand(sql, conn);

            var result = cmd.ExecuteScalar();

            geojson = result?.ToString() ?? "{}";

            return Ok(geojson);
        }
    }
}
